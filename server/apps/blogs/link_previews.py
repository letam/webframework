"""URL extraction and server-side metadata fetching for post link previews."""

import html
import ipaddress
import logging
import re
import socket
from datetime import UTC, date, datetime
from html.parser import HTMLParser
from io import BytesIO
from urllib.parse import parse_qs, quote, urljoin, urlparse

import httpx
from django.core.files.base import ContentFile
from django.utils import timezone
from PIL import Image

from .models import LinkPreview

logger = logging.getLogger(__name__)

MAX_LINKS_PER_POST = 3
FETCH_TIMEOUT = 8.0
MAX_HTML_BYTES = 2_000_000
MAX_IMAGE_BYTES = 5_000_000
MAX_REDIRECTS = 5
USER_AGENT = 'webframework-linkpreview/1.0 (+https://github.com/tam/webframework)'

URL_RE = re.compile(r'(?:https?://|www\.)[^\s<>"\']+', re.IGNORECASE)
YOUTUBE_VIDEO_ID_RE = re.compile(r'^[A-Za-z0-9_-]{6,20}$')
TWITTER_STATUS_RE = re.compile(r'^/([^/]+)/status/\d+/?', re.IGNORECASE)
TWEET_DATE_RE = re.compile(r'>\s*([A-Z][a-z]+ \d{1,2}, \d{4})\s*</a>\s*</blockquote>')
TWITTER_SNOWFLAKE_EPOCH_MS = 1288834974657
REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class MetadataParser(HTMLParser):
    """Collect basic document metadata from HTML."""

    def __init__(self):
        """Initialize parser state."""
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title_parts: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        """Record title/meta tag openings."""
        attrs_dict = {name.lower(): value for name, value in attrs if value is not None}
        if tag.lower() == 'title':
            self._in_title = True
            return

        if tag.lower() != 'meta':
            return

        key = attrs_dict.get('property') or attrs_dict.get('name') or attrs_dict.get('itemprop')
        content = attrs_dict.get('content')
        if key and content:
            self.meta[key.lower()] = content.strip()

    def handle_endtag(self, tag):
        """Record title tag closings."""
        if tag.lower() == 'title':
            self._in_title = False

    def handle_data(self, data):
        """Collect text inside the title tag."""
        if self._in_title:
            self.title_parts.append(data)

    @property
    def title(self):
        """Return the normalized title text."""
        return ' '.join(''.join(self.title_parts).split())


class ParagraphTextParser(HTMLParser):
    """Extract text from the first paragraph in an HTML fragment."""

    def __init__(self):
        """Initialize parser state."""
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._in_paragraph = False
        self._seen_paragraph = False

    def handle_starttag(self, tag, attrs):
        """Track entry into the first paragraph."""
        if tag.lower() == 'p' and not self._seen_paragraph:
            self._in_paragraph = True
            self._seen_paragraph = True

    def handle_endtag(self, tag):
        """Track exit from the paragraph."""
        if tag.lower() == 'p':
            self._in_paragraph = False

    def handle_data(self, data):
        """Collect text inside the paragraph."""
        if self._in_paragraph:
            self.parts.append(data)

    @property
    def text(self):
        """Return the normalized paragraph text."""
        return ' '.join(html.unescape(''.join(self.parts)).split())


def extract_urls(text: str) -> list[str]:
    """Return up to three unique URLs from post text."""
    urls = []
    seen = set()

    for match in URL_RE.finditer(text):
        url = match.group(0).rstrip('.,;:!?"\'')
        if url.endswith(')') and '(' not in url:
            url = url[:-1]
        if url.lower().startswith('www.'):
            url = f'https://{url}'

        if url not in seen:
            seen.add(url)
            urls.append(url)
            if len(urls) >= MAX_LINKS_PER_POST:
                break

    return urls


def detect_kind(url: str) -> tuple[str, str]:
    """Return the preview kind and provider identifier for a URL."""
    parsed = urlparse(url)
    hostname = (parsed.hostname or '').lower().rstrip('.')
    path = parsed.path or ''

    if hostname in {
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'youtu.be',
        'music.youtube.com',
    }:
        video_id = ''
        if hostname == 'youtu.be':
            video_id = path.strip('/').split('/', 1)[0]
        elif path == '/watch':
            video_id = parse_qs(parsed.query).get('v', [''])[0]
        else:
            path_parts = [part for part in path.split('/') if part]
            if len(path_parts) >= 2 and path_parts[0] in {'shorts', 'live', 'embed'}:
                video_id = path_parts[1]

        if YOUTUBE_VIDEO_ID_RE.match(video_id):
            return 'youtube', video_id

    if hostname in {'x.com', 'twitter.com', 'mobile.twitter.com'}:
        match = TWITTER_STATUS_RE.match(path)
        if match:
            return 'twitter', match.group(1)

    return 'generic', ''


def _address_is_safe(address: str) -> bool:
    ip_address = ipaddress.ip_address(address)
    return not (
        ip_address.is_private
        or ip_address.is_loopback
        or ip_address.is_link_local
        or ip_address.is_multicast
        or ip_address.is_reserved
        or ip_address.is_unspecified
    )


def _url_is_safe(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {'http', 'https'}:
        return False
    if parsed.username is not None or parsed.password is not None:
        return False
    try:
        port = parsed.port
    except ValueError:
        return False
    if port is not None and port not in {80, 443}:
        return False

    hostname = parsed.hostname
    if not hostname:
        return False

    try:
        return _address_is_safe(hostname)
    except ValueError:
        pass

    try:
        addresses = socket.getaddrinfo(hostname, port or 443, type=socket.SOCK_STREAM)
    except OSError:
        return False

    for address in addresses:
        try:
            ip_address = address[4][0]
        except (IndexError, TypeError):
            return False
        try:
            if not _address_is_safe(ip_address):
                return False
        except ValueError:
            return False

    return True


def _safe_get(url: str, *, max_bytes: int) -> httpx.Response | None:
    """Fetch a URL after SSRF checks, returning None for any refusal or failure."""
    try:
        current_url = url
        with httpx.Client(
            follow_redirects=False,
            timeout=FETCH_TIMEOUT,
            headers={'User-Agent': USER_AGENT, 'Accept-Language': 'en'},
        ) as client:
            for _redirect_count in range(MAX_REDIRECTS + 1):
                if not _url_is_safe(current_url):
                    return None

                with client.stream('GET', current_url) as response:
                    if response.status_code in REDIRECT_STATUSES:
                        location = response.headers.get('location')
                        if not location:
                            return None
                        current_url = urljoin(str(response.url), location)
                        continue

                    content = bytearray()
                    for chunk in response.iter_bytes():
                        content.extend(chunk)
                        if len(content) > max_bytes:
                            return None

                    # iter_bytes() already decompressed the body, so drop the
                    # stale encoding headers or the rebuilt response decodes twice.
                    headers = response.headers.copy()
                    headers.pop('content-encoding', None)
                    headers.pop('content-length', None)
                    return httpx.Response(
                        status_code=response.status_code,
                        headers=headers,
                        content=bytes(content),
                        request=response.request,
                    )
    except Exception:
        logger.info('Failed to fetch link preview URL %s', url, exc_info=True)
        return None

    return None


def _decode_response(response: httpx.Response) -> str:
    encoding = response.encoding or 'utf-8'
    try:
        return response.content.decode(encoding, errors='replace')
    except LookupError:
        return response.content.decode('utf-8', errors='replace')


def _parse_html_metadata(text: str) -> MetadataParser:
    parser = MetadataParser()
    parser.feed(text)
    return parser


def _parse_iso_date(value: str) -> date | None:
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        return None


def _tweet_date_from_snowflake(url: str) -> date | None:
    """Derive a tweet's date from its snowflake status ID."""
    match = re.search(r'/status/(\d+)', urlparse(url).path)
    if not match:
        return None

    status_id = int(match.group(1))
    # Pre-snowflake IDs (before Nov 2010) are sequential and encode no timestamp.
    if status_id < (1 << 40):
        return None

    milliseconds = (status_id >> 22) + TWITTER_SNOWFLAKE_EPOCH_MS
    return datetime.fromtimestamp(milliseconds / 1000, tz=UTC).date()


def fetch_youtube(url: str, video_id: str) -> dict[str, object] | None:
    """Fetch YouTube oEmbed and best-effort page metadata."""
    oembed_url = f'https://www.youtube.com/oembed?url={quote(url, safe="")}&format=json'
    oembed = _safe_get(oembed_url, max_bytes=MAX_HTML_BYTES)
    title = ''
    author_name = ''
    thumbnail_url = ''

    if oembed is not None and oembed.status_code < 400:
        try:
            data = oembed.json()
            title = str(data.get('title') or '')
            author_name = str(data.get('author_name') or '')
            thumbnail_url = str(data.get('thumbnail_url') or '')
        except ValueError:
            pass

    description = ''
    author_handle = ''
    page_title = ''
    published_at = None
    page = _safe_get(f'https://www.youtube.com/watch?v={video_id}', max_bytes=MAX_HTML_BYTES)
    if page is not None and page.status_code < 400:
        page_text = _decode_response(page)
        parser = _parse_html_metadata(page_text)
        page_title = parser.meta.get('og:title', '')
        description = parser.meta.get('og:description', '')
        handle_match = re.search(
            r'"ownerProfileUrl":"https?://www\.youtube\.com/@([^"]+)"', page_text
        ) or re.search(
            r'"ownerProfileUrl":"https?:\\?/\\?/www\.youtube\.com\\?/@([^"]+)"',
            page_text,
        )
        if handle_match:
            author_handle = handle_match.group(1)

        published_raw = parser.meta.get('datepublished') or parser.meta.get('uploaddate') or ''
        if not published_raw:
            publish_match = re.search(r'"publishDate":"([^"]+)"', page_text)
            if publish_match:
                published_raw = publish_match.group(1)
        published_at = _parse_iso_date(published_raw)

    if not title:
        title = page_title
    if not title:
        return None

    return {
        'kind': 'youtube',
        'title': title,
        'description': description,
        'site_name': 'YouTube',
        'author_name': author_name,
        'author_handle': author_handle,
        'embed_id': video_id,
        'published_at': published_at,
        'image_url': thumbnail_url or f'https://i.ytimg.com/vi/{video_id}/hqdefault.jpg',
    }


def fetch_twitter(url: str, handle: str) -> dict[str, object] | None:
    """Fetch Twitter/X oEmbed metadata."""
    oembed_url = (
        f'https://publish.twitter.com/oembed?url={quote(url, safe="")}'
        '&omit_script=true&dnt=true&hide_thread=true&lang=en'
    )
    response = _safe_get(oembed_url, max_bytes=MAX_HTML_BYTES)
    if response is None or response.status_code >= 400:
        return None

    try:
        data = response.json()
    except ValueError:
        return None

    oembed_html = str(data.get('html') or '')
    parser = ParagraphTextParser()
    parser.feed(oembed_html)
    tweet_text = parser.text

    # The blockquote ends with the tweet's date as anchor text ("March 21, 2006"
    # with lang=en); the snowflake ID covers tweets where that ever changes.
    published_at = None
    date_match = TWEET_DATE_RE.search(oembed_html)
    if date_match:
        try:
            published_at = datetime.strptime(date_match.group(1), '%B %d, %Y').date()
        except ValueError:
            published_at = None
    if published_at is None:
        published_at = _tweet_date_from_snowflake(url)

    return {
        'kind': 'twitter',
        'title': '',
        'description': tweet_text,
        'site_name': 'X',
        'author_name': str(data.get('author_name') or ''),
        'author_handle': handle,
        'embed_id': '',
        'published_at': published_at,
    }


def fetch_generic(url: str) -> dict[str, object] | None:
    """Fetch generic OpenGraph metadata for a page."""
    response = _safe_get(url, max_bytes=MAX_HTML_BYTES)
    if response is None or response.status_code >= 400:
        return None

    content_type = response.headers.get('content-type', '')
    if 'text/html' not in content_type.lower():
        return None

    parser = _parse_html_metadata(_decode_response(response))
    title = parser.meta.get('og:title') or parser.meta.get('twitter:title') or parser.title
    description = (
        parser.meta.get('og:description')
        or parser.meta.get('twitter:description')
        or parser.meta.get('description')
        or ''
    )
    if not title and not description:
        return None

    image_url = parser.meta.get('og:image') or parser.meta.get('twitter:image') or ''
    if image_url:
        image_url = urljoin(str(response.url), image_url)

    return {
        'kind': 'generic',
        'title': title,
        'description': description,
        'site_name': parser.meta.get('og:site_name', ''),
        'author_name': '',
        'author_handle': '',
        'embed_id': '',
        'published_at': _parse_iso_date(parser.meta.get('article:published_time', '')),
        'image_url': image_url,
    }


def download_preview_image(preview: LinkPreview, image_url: str) -> None:
    """Download, validate, normalize, and save a preview image."""
    response = _safe_get(image_url, max_bytes=MAX_IMAGE_BYTES)
    if response is None:
        return
    if not response.headers.get('content-type', '').lower().startswith('image/'):
        return

    try:
        with Image.open(BytesIO(response.content)) as source_image:
            source_image.thumbnail((640, 640))
            if source_image.mode in {'RGBA', 'LA'} or (
                source_image.mode == 'P' and 'transparency' in source_image.info
            ):
                rgba_image = source_image.convert('RGBA')
                normalized = Image.new('RGB', rgba_image.size, 'white')
                normalized.paste(rgba_image, mask=rgba_image.getchannel('A'))
            else:
                normalized = source_image.convert('RGB')

            output = BytesIO()
            normalized.save(output, format='JPEG', quality=80)
    except Exception:
        logger.info('Failed to process link preview image %s', image_url, exc_info=True)
        return

    preview.image.save(f'{preview.pk}.jpg', ContentFile(output.getvalue()), save=False)


def _truncate(value: object, max_length: int) -> str:
    return str(value or '')[:max_length]


def fetch_preview_for(preview: LinkPreview) -> None:
    """Fetch and persist metadata for a pending link preview."""
    if preview.kind == 'youtube':
        data = fetch_youtube(preview.url, preview.embed_id)
    elif preview.kind == 'twitter':
        data = fetch_twitter(preview.url, preview.author_handle)
    else:
        data = fetch_generic(preview.url)

    preview.fetched_at = timezone.now()
    if data is None:
        preview.status = 'failed'
        preview.save(update_fields=['status', 'fetched_at'])
        return

    preview.kind = _truncate(data.get('kind') or preview.kind, 16)
    preview.title = _truncate(data.get('title'), 500)
    preview.description = str(data.get('description') or '')
    preview.site_name = _truncate(data.get('site_name'), 200)
    preview.author_name = _truncate(data.get('author_name'), 200)
    preview.author_handle = _truncate(data.get('author_handle') or preview.author_handle, 100)
    preview.embed_id = _truncate(data.get('embed_id') or preview.embed_id, 100)
    published_at = data.get('published_at')
    preview.published_at = published_at if isinstance(published_at, date) else None

    image_url = data.get('image_url')
    if image_url:
        download_preview_image(preview, str(image_url))

    preview.status = 'ok'
    preview.save(
        update_fields=[
            'kind',
            'status',
            'title',
            'description',
            'site_name',
            'author_name',
            'author_handle',
            'embed_id',
            'published_at',
            'image',
            'fetched_at',
        ]
    )


def sync_link_previews(post) -> bool:
    """Synchronize a post's LinkPreview rows with the URLs in its text."""
    urls = extract_urls(f'{post.head}\n{post.body}')
    stale_previews = post.link_previews.all()
    if urls:
        stale_previews = stale_previews.exclude(url__in=urls)
    for preview in stale_previews:
        preview.delete()

    existing_previews = {preview.url: preview for preview in post.link_previews.all()}
    for position, url in enumerate(urls):
        preview = existing_previews.get(url)
        if preview is None:
            kind, provider_id = detect_kind(url)
            create_kwargs = {
                'post': post,
                'url': url,
                'position': position,
                'kind': kind,
            }
            if kind == 'youtube':
                create_kwargs['embed_id'] = provider_id
            if kind == 'twitter':
                create_kwargs['author_handle'] = provider_id
            LinkPreview.objects.create(**create_kwargs)
            continue

        if preview.position != position:
            preview.position = position
            preview.save(update_fields=['position'])

    return post.link_previews.filter(status='pending').exists()
