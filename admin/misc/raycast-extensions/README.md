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

# Text post with browser opening (using any character)
text-to-web "Hello from Raycast!" "" "y"

# Text post with browser opening (using '1')
text-to-web "Hello from Raycast!" "" "1"

# Text post with browser opening (using any character)
text-to-web "Hello from Raycast!" "" "x"

# Longer content
text-to-web "This is a longer post with multiple sentences. It can contain any text content that you want to share on your web application."

# With special characters
text-to-web "Check out this link: https://example.com 🚀"

# With body and head (using both arguments)
text-to-web "This is the body content" "My Post Title"

# With body, head, and browser opening (using any character)
text-to-web "This is the body content" "My Post Title" "o"

# With body, head, and no browser opening (explicit)
text-to-web "This is the body content" "My Post Title" "0"

# With body, head, and no browser opening (using 'false')
text-to-web "This is the body content" "My Post Title" "false"
```

## Configuration Options

### Script Parameters

The script accepts three parameters:

1. **body** (required): The body content for the post
2. **head** (optional): The title or headline for the post  
3. **open_url** (optional): Whether to open the created post in browser
   - Any value: Opens the post URL in your default browser
   - `"f"`, `"false"`, `"0"`, `"n"`, or `"no"` (default): Only displays the URL without opening it

### Environment Variables

You can customize the following variables in the script:

- `WEB_APP_URL`: The base URL of your web application
- `MAX_HEAD_LENGTH`: Maximum allowed head/title length (default: 255)

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
- ❌ Head too long (exceeds 255 character limit)
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

3. **"Head too long"**
   - Reduce the head/title length or increase `MAX_HEAD_LENGTH` in the script

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

---

# Testing

This directory contains comprehensive tests for the `capture-text.sh` Raycast extension script.

## Test Files

- `capture-text.sh` - The main Raycast extension script for submitting text to the web app
- `test-capture-text.sh` - Comprehensive test suite for the capture-text script
- `README.md` - This documentation file

## Test Coverage

The test suite covers the following scenarios:

### JSON Construction Tests
- ✅ Basic text handling
- ✅ Text with quotes (`"Hello world"`)
- ✅ Text with apostrophes (`It's a beautiful day`)
- ✅ Mixed quotes and apostrophes (`He said "It's a beautiful day"`)
- ✅ Text with head and body
- ✅ Complex multi-line text with special characters
- ✅ Empty text handling
- ✅ Very long text (stress test)
- ✅ Text with backslashes (`C:\Users\test\file.txt`)
- ✅ Unicode characters (`Hello 世界 🌍`)
- ✅ Edge cases (only quotes, only apostrophes, mixed delimiters)

### URL Decoding Tests
- ✅ URL-encoded spaces (`Hello%20world`)
- ✅ URL-encoded special characters (`Hello%21%20world`)
- ✅ URL-encoded quotes (`He%20said%20%22Hello%22`)

### Script Execution Tests
- ✅ Basic script execution (body only)
- ✅ Script execution with head and body
- ✅ Script execution with special characters

### Error Handling
- ✅ Tests both `jq` and fallback JSON construction methods
- ✅ Validates JSON structure and content
- ✅ Handles server availability gracefully

## Running the Tests

### Prerequisites
- The Django development server should be running (`uv run python server/manage.py runserver_plus`)
- The script should be executable (`chmod +x test-capture-text.sh`)

### Run All Tests
```bash
cd /Users/tam/code/webframework
./admin/misc/raycast-extensions/test-capture-text.sh
```

### Test Output
The test script provides colored output:
- 🟢 **Green**: Tests that passed
- 🔴 **Red**: Tests that failed
- 🟡 **Yellow**: Warnings or informational messages
- 🔵 **Blue**: Test section headers

### Expected Results
When all tests pass, you should see:
```
📊 Test Results
Tests run: 32
Tests passed: 32
Tests failed: 0
🎉 All tests passed!
```

## Test Categories

### 1. JSON Construction Tests
Tests the core functionality of constructing valid JSON payloads from user input. This is the most critical part since the original issue was JSON parsing errors.

### 2. URL Decoding Tests
Tests the URL decoding functionality that handles percent-encoded characters from Raycast input.

### 3. Script Execution Tests
Tests the actual script execution with the live server to ensure end-to-end functionality works correctly.

## Troubleshooting

### Common Issues

1. **"jq not available"**: The tests will still run using the fallback JSON construction method
2. **"Server not running"**: Script execution tests will be skipped if the Django server isn't running
3. **Permission denied**: Make sure the test script is executable (`chmod +x test-capture-text.sh`)

### Debugging Failed Tests

If a test fails, the output will show:
- The test name that failed
- Details about why it failed
- The specific error message

## Integration with CI/CD

The test script returns appropriate exit codes:
- `0`: All tests passed
- `1`: Some tests failed

This makes it suitable for integration with CI/CD pipelines or automated testing systems.

## Adding New Tests

To add new test cases:

1. Add a new test function call in the main test section
2. Follow the existing pattern for test naming and structure
3. Ensure the test covers edge cases or specific scenarios
4. Run the test suite to verify the new test works correctly

Example:
```bash
# Add a new test
test_json_construction "New test case" "test input" "optional head" "expected pattern"
```
