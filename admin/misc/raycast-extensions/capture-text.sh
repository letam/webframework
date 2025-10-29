#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title text-to-web
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 🤖
# @raycast.packageName Brainshart
# @raycast.argument1 { "type": "text", "placeholder": "body", "percentEncoded": true }
# @raycast.argument2 { "type": "text", "placeholder": "head", "percentEncoded": true, "optional": true }
# @raycast.argument3 { "type": "text", "placeholder": "open_url", "optional": true, "default": "0" }

# Documentation:
# @raycast.description Create a new entry in the web app
# @raycast.author Tam Le
# @raycast.authorURL https://linkedin.com/in/letam

# echo "Hello World!"

# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
    # Source the .env file to load environment variables
    set -a  # automatically export all variables
    source .env
    set +a  # stop automatically exporting
fi

# Configuration - Get WEB_APP_URL from .env with fallback to localhost:8000
WEB_APP_URL="${WEB_APP_URL:-http://localhost:8000}"
API_ENDPOINT="${WEB_APP_URL}/api/posts/"

MAX_HEAD_LENGTH=255

# Colors for output (optional - remove if you prefer plain text)
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}📝 $1${NC}"
}

print_link() {
    echo -e "${YELLOW}🔗 $1${NC}"
}

# Function to URL decode text
url_decode() {
    printf '%b\n' "${1//%/\\x}"
}

# Check if text argument is provided
if [ -z "$1" ]; then
    print_error "No text provided"
    echo "Usage: text-to-web \"body text\" [\"head text\"] [open_url]"
    echo "  open_url: any value (opens browser), or 'f', 'false', '0', 'n', 'no' (default, don't open)"
    exit 1
fi

TEXT="$1"
HEAD="$2"
# URL decode the text to handle spaces and special characters from Raycast
TEXT=$(url_decode "$TEXT")
if [ -n "$HEAD" ]; then
    HEAD=$(url_decode "$HEAD")
fi
# Use DEBUG_OPEN_URL from .env as default if present, otherwise default to 0
DEFAULT_OPEN_URL="${DEBUG_OPEN_URL:-0}"
OPEN_URL="${3:-$DEFAULT_OPEN_URL}"

# Validate head length if provided
if [ -n "$HEAD" ] && [ ${#HEAD} -gt $MAX_HEAD_LENGTH ]; then
    print_error "Head too long (max $MAX_HEAD_LENGTH characters)"
    exit 1
fi

# Determine if we should open the browser
# Default to false (don't open browser) unless explicitly set to true values
SHOULD_OPEN_BROWSER=false
if [ "$OPEN_URL" != "f" ] && [ "$OPEN_URL" != "false" ] && [ "$OPEN_URL" != "0" ] && [ "$OPEN_URL" != "n" ] && [ "$OPEN_URL" != "no" ]; then
    SHOULD_OPEN_BROWSER=true
fi

print_info "Submitting text to web app..."

# Check if jq is available for proper JSON escaping
if command -v jq >/dev/null 2>&1; then
    # Prepare JSON payload using jq for proper escaping
    if [ -n "$HEAD" ]; then
        JSON_PAYLOAD=$(jq -n --arg head "$HEAD" --arg body "$TEXT" '{head: $head, body: $body}')
    else
        JSON_PAYLOAD=$(jq -n --arg body "$TEXT" '{body: $body}')
    fi
else
    # Fallback: Basic escaping for common characters (not as robust as jq)
    ESCAPED_TEXT=$(echo "$TEXT" | sed 's/\\/\\\\/g; s/"/\\"/g; s/'"'"'/\\'"'"'/g')
    ESCAPED_HEAD=""
    if [ -n "$HEAD" ]; then
        ESCAPED_HEAD=$(echo "$HEAD" | sed 's/\\/\\\\/g; s/"/\\"/g; s/'"'"'/\\'"'"'/g')
        JSON_PAYLOAD="{\"head\": \"$ESCAPED_HEAD\", \"body\": \"$ESCAPED_TEXT\"}"
    else
        JSON_PAYLOAD="{\"body\": \"$ESCAPED_TEXT\"}"
    fi
    print_info "Using basic JSON escaping (install 'jq' for better handling of special characters)"
fi

# Make API request to create post with minimal response
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_ENDPOINT}?minres=1" \
    -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD")

# Extract HTTP status code and response body
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')

# Check if request was successful
if [ "$HTTP_CODE" -eq 201 ]; then
    # Extract post ID from response using a more robust approach
    # Match the first "id" field (which is the post ID) before any nested objects
    POST_ID=$(echo "$RESPONSE_BODY" | sed -n 's/^{"id":\([0-9]*\).*/\1/p')
    
    if [ -n "$POST_ID" ]; then
        POST_URL="${WEB_APP_URL}/p/${POST_ID}/"
        print_success "Post created successfully!"
        print_link "Post URL: $POST_URL"
        echo "📄 Post ID: $POST_ID"
        
        # Optionally open the post in browser based on parameter
        if [ "$SHOULD_OPEN_BROWSER" = "true" ] && command -v open >/dev/null 2>&1; then
            open "$POST_URL"
        fi
    else
        print_success "Post created successfully!"
        echo "📄 Response: $RESPONSE_BODY"
    fi
else
    print_error "Failed to create post (HTTP $HTTP_CODE)"
    echo "📄 Response: $RESPONSE_BODY"
    exit 1
fi
