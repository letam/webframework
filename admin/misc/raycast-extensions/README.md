# Raycast Extension: Text to Web

This Raycast extension allows you to quickly submit text content to your web application directly from Raycast.

## Features

- ✅ Submit text content to create new posts
- ✅ Automatic post URL generation and display
- ✅ Optional browser opening of created posts
- ✅ Input validation (text length limits)
- ✅ Comprehensive error handling
- ✅ Colored output for better user experience
- ✅ Configurable web app URL

## Setup

### 1. Install the Script

The script is located at `admin/misc/raycast-extensions/capture-text.sh` and is already executable.

### 2. Configure Raycast

1. Open Raycast
2. Go to Extensions → Script Commands
3. Click "Add Script Command"
4. Choose "From File" and select `capture-text.sh`
5. Configure the following:
   - **Title**: `text-to-web` (or your preferred name)
   - **Mode**: `Compact`
   - **Icon**: Choose an appropriate icon (🤖 is used by default)

### 3. Configure the Web App URL

Edit the script and update the `WEB_APP_URL` variable:

```bash
# For local development
WEB_APP_URL="http://localhost:8000"

# For production
WEB_APP_URL="https://your-domain.com"
```

## Usage

### Basic Usage

1. Open Raycast (⌘ + Space)
2. Type your script name (e.g., "text-to-web")
3. Enter your text content
4. Press Enter

### Examples

```bash
# Simple text post (doesn't open browser by default)
text-to-web "Hello from Raycast!"

# Text post with browser opening (using 'y')
text-to-web "Hello from Raycast!" "" "y"

# Longer content
text-to-web "This is a longer post with multiple sentences. It can contain any text content that you want to share on your web application."

# With special characters
text-to-web "Check out this link: https://example.com 🚀"

# With body and head (using both arguments)
text-to-web "This is the body content" "My Post Title"

# With body, head, and browser opening (using 'o')
text-to-web "This is the body content" "My Post Title" "o"

# With body, head, and no browser opening (explicit)
text-to-web "This is the body content" "My Post Title" "0"
```

## Configuration Options

### Script Parameters

The script accepts three parameters:

1. **body** (required): The body content for the post
2. **head** (optional): The title or headline for the post  
3. **open_url** (optional): Whether to open the created post in browser
   - `"1"`, `"o"`, or `"y"`: Opens the post URL in your default browser
   - `"0"` (default): Only displays the URL without opening it

### Environment Variables

You can customize the following variables in the script:

- `WEB_APP_URL`: The base URL of your web application
- `MAX_TEXT_LENGTH`: Maximum allowed text length (default: 1000)

### Customization

The script includes several customizable features:

1. **Colors**: Remove color codes if you prefer plain text output
2. **Browser Opening**: Control whether to open created posts in browser via the `open_url` parameter
3. **Error Messages**: Customize error messages and validation rules
4. **Parameter Validation**: Input validation for all parameters including the new `open_url` option

## API Requirements

This extension requires your web application to have:

1. A REST API endpoint at `/api/posts/` that accepts POST requests
2. JSON request format: `{"body": "your text content"}`
3. JSON response format with an `id` field for the created post
4. HTTP 201 status code for successful creation

## Error Handling

The script handles various error scenarios:

- ❌ No text provided
- ❌ Text too long (exceeds character limit)
- ❌ Server not running or unreachable
- ❌ API errors (invalid response, server errors)

## Troubleshooting

### Common Issues

1. **"Failed to create post (HTTP 000)"**
   - Check if your web application server is running
   - Verify the `WEB_APP_URL` is correct

2. **"No text provided"**
   - Make sure you're passing text as an argument to the script
   - Check Raycast configuration

3. **"Text too long"**
   - Reduce the text length or increase `MAX_TEXT_LENGTH` in the script

### Debug Mode

To debug issues, you can run the script directly from the terminal:

```bash
./capture-text.sh "Your test text here"
```

This will show detailed output including HTTP status codes and response bodies.

## Development

### Testing

Test the script with various scenarios:

```bash
# Test with valid input
./capture-text.sh "Valid test post"

# Test with no input
./capture-text.sh

# Test with long input
./capture-text.sh "$(printf 'a%.0s' {1..1001})"

# Test with server down
# (stop your web server first)
./capture-text.sh "Test with server down"
```

### Modifications

To modify the script:

1. Edit `capture-text.sh`
2. Test your changes
3. Update Raycast to use the modified script

## Security Considerations

- The script sends data over HTTP/HTTPS to your web application
- Ensure your web application has proper authentication if needed
- Consider using HTTPS in production environments
- Validate input on both client and server sides

## License

This extension is part of the Web Framework project and follows the same license terms.
