import os


class HttpRangesMiddleware:
    """Middleware to handle HTTP byte ranges.
    Reference: https://stackoverflow.com/questions/14324250/byte-ranges-in-django/35928017#35928017
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Let Django (and later middleware) run and get a response
        response = self.get_response(request)

        # Only handle full-file responses with an attached file stream
        if response.status_code != 200 or not hasattr(response, 'file_to_stream'):
            return response

        http_range = request.META.get('HTTP_RANGE')
        # Must be a single contiguous-byte-range header
        if not (http_range and http_range.startswith('bytes=') and http_range.count('-') == 1):
            return response

        # Honor If-Range
        if_range = request.META.get('HTTP_IF_RANGE')
        if (
            if_range
            and if_range != response.get('Last-Modified')
            and if_range != response.get('ETag')
        ):
            return response

        f = response.file_to_stream
        statobj = os.fstat(f.fileno())

        # Parse start/end
        start_str, end_str = http_range[len('bytes=') :].split('-')
        if not start_str:
            # suffix-byte-range: e.g. "bytes=-500"
            start = max(0, statobj.st_size - int(end_str))
            end = statobj.st_size - 1
        else:
            start = int(start_str)
            end = int(end_str) if end_str else statobj.st_size - 1

        # Validate & clamp
        assert 0 <= start < statobj.st_size, (start, statobj.st_size)
        end = min(end, statobj.st_size - 1)

        # Seek and wrap the file read to not exceed the requested length
        f.seek(start)
        old_read = f.read
        f.read = lambda n=-1: old_read(min(n, end + 1 - f.tell()))

        # Turn into a partial (206) response
        response.status_code = 206
        response['Content-Length'] = str(end + 1 - start)
        response['Content-Range'] = f'bytes {start}-{end}/{statobj.st_size}'

        return response
