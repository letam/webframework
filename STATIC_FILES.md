# Static Files Management

This web framework includes a comprehensive static files management system that makes it easy to host and serve static files on your Django server.

## Features

- **Web Interface**: Easy-to-use web interface for uploading, managing, and serving static files
- **API Endpoints**: RESTful API for programmatic file management
- **Command Line Tools**: Management commands and utility scripts
- **Automatic Organization**: Files can be organized by type (images, CSS, JS, etc.)
- **Security**: Protection against directory traversal attacks
- **Caching**: Proper HTTP caching headers for optimal performance

## Quick Start

### 1. Web Interface

Visit the static files manager in your browser:
```
http://localhost:8000/static/manager/
```

This provides a user-friendly interface where you can:
- Upload files by drag-and-drop or file selection
- View all uploaded files with their URLs
- Copy file URLs to clipboard
- Delete files
- View files directly in the browser

### 2. API Usage

#### Upload a File
```bash
curl -X POST http://localhost:8000/static/upload/ \
  -F "file=@/path/to/your/file.jpg" \
  -F "path=images/my-image.jpg"
```

#### List All Files
```bash
curl http://localhost:8000/static/list/
```

#### Get File Information
```bash
curl http://localhost:8000/static/info/images/my-image.jpg
```

#### Delete a File
```bash
curl -X DELETE http://localhost:8000/static/upload/ \
  -H "Content-Type: application/json" \
  -d '{"path": "images/my-image.jpg"}'
```

#### Serve a File
Files are automatically served at:
```
http://localhost:8000/static/files/path/to/your/file.jpg
```

### 3. Command Line Tools

#### Using the Management Command
```bash
# List all static files
uv run python server/manage.py manage_static list

# Upload files from a directory
uv run python server/manage.py manage_static upload --source /path/to/files --category images

# Organize files by type
uv run python server/manage.py manage_static organize

# Clean up duplicate files
uv run python server/manage.py manage_static clean

# Dry run (see what would be done)
uv run python server/manage.py manage_static organize --dry-run
```

#### Using the Utility Script
```bash
# Upload a file
python scripts/manage-static-files.py upload /path/to/file.jpg --target images/photo.jpg

# List all files
python scripts/manage-static-files.py list

# Get file info
python scripts/manage-static-files.py info images/photo.jpg

# Delete a file
python scripts/manage-static-files.py delete images/photo.jpg

# Get file URL
python scripts/manage-static-files.py serve images/photo.jpg
```

## File Organization

The system supports automatic file organization by type:

- **images/**: .jpg, .jpeg, .png, .gif, .svg, .webp, .ico
- **css/**: .css
- **js/**: .js
- **fonts/**: .woff, .woff2, .ttf, .otf
- **documents/**: .pdf, .doc, .docx, .txt
- **media/**: .mp4, .mp3, .wav, .avi, .mov

## Configuration

### Static Files Settings

The system uses Django's standard static files configuration:

```python
STATIC_URL = '/static/'
STATIC_ROOT = 'server/static'
```

### Security

- Directory traversal protection (prevents `../` attacks)
- File type validation
- Path sanitization
- CSRF protection for uploads

### Caching

Static files are served with optimal caching headers:
- `Cache-Control: public, max-age=31536000` (1 year)
- ETag headers for efficient cache validation

## Production Considerations

### Nginx Configuration

For production, configure Nginx to serve static files directly:

```nginx
location /static/ {
    alias /path/to/your/project/server/static/;
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

### CDN Integration

For high-traffic applications, consider using a CDN:

1. Upload files to your CDN
2. Update the `STATIC_URL` setting to point to your CDN
3. Use the management commands to sync files

### File Storage

The system supports both local file storage and cloud storage:

- **Local**: Files stored in `server/static/`
- **Cloud**: Configure with Django storage backends (S3, etc.)

## Examples

### Upload an Image
```python
import requests

# Upload via API
with open('photo.jpg', 'rb') as f:
    response = requests.post(
        'http://localhost:8000/static/upload/',
        files={'file': f},
        data={'path': 'images/photo.jpg'}
    )
    
if response.status_code == 200:
    file_url = response.json()['file_url']
    print(f"Image uploaded: {file_url}")
```

### Serve in Templates
```html
<!-- In your Django templates -->
<img src="{% static 'images/photo.jpg' %}" alt="Photo">

<!-- Or use the direct URL -->
<img src="/static/files/images/photo.jpg" alt="Photo">
```

### JavaScript Integration
```javascript
// Upload file via JavaScript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('path', 'uploads/' + fileInput.files[0].name);

fetch('/static/upload/', {
    method: 'POST',
    body: formData
})
.then(response => response.json())
.then(data => {
    console.log('File uploaded:', data.file_url);
});
```

## Troubleshooting

### Common Issues

1. **File not found**: Check the file path and ensure it exists in the static directory
2. **Upload fails**: Verify file permissions and available disk space
3. **CORS issues**: Ensure CORS is properly configured for API calls
4. **Cache issues**: Clear browser cache or add cache-busting parameters

### Debug Mode

Enable Django debug mode to see detailed error messages:
```python
DEBUG = True
```

### Logs

Check Django logs for detailed error information:
```bash
tail -f log/server-errors.log
```

## API Reference

### Endpoints

- `GET /static/manager/` - Web interface
- `GET /static/files/<path>` - Serve static file
- `POST /static/upload/` - Upload file
- `DELETE /static/upload/` - Delete file
- `GET /static/list/` - List all files
- `GET /static/info/<path>` - Get file info

### Response Formats

All API responses are in JSON format:

```json
{
    "success": true,
    "file_path": "images/photo.jpg",
    "file_url": "/static/files/images/photo.jpg",
    "size": 12345
}
```

Error responses:
```json
{
    "error": "Error message describing what went wrong"
}
```
