#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title text-to-web
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 🤖
# @raycast.packageName Brainshart
# @raycast.argument1 { "type": "text", "placeholder": "head", "percentEncoded": true }
# @raycast.argument2 { "type": "text", "placeholder": "body", "percentEncoded": true, "optional": true }

# Documentation:
# @raycast.description capture text input to web app

# echo "Hello World!"

# Configuration - Update these values for your setup
WEB_APP_URL="http://localhost:8000"
API_ENDPOINT="${WEB_APP_URL}/api/posts/"
MAX_TEXT_LENGTH=1000

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

# Check if text argument is provided
if [ -z "$1" ]; then
    print_error "No text provided"
    echo "Usage: text-to-web \"Your text here\""
    exit 1
fi

TEXT="$1"

# Validate text length
if [ ${#TEXT} -gt $MAX_TEXT_LENGTH ]; then
    print_error "Text too long (max $MAX_TEXT_LENGTH characters)"
    exit 1
fi

print_info "Submitting text to web app..."

# Make API request to create post with minimal response
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_ENDPOINT}?minres=1" \
    -H "Content-Type: application/json" \
    -d "{\"body\": \"$TEXT\"}")

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
        
        # Optionally open the post in browser
        if command -v open >/dev/null 2>&1; then
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
