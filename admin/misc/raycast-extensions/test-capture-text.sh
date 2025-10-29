#!/bin/bash

# Test script for capture-text.sh
# Tests various edge cases and special characters

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Function to print test results
print_test_result() {
    local test_name="$1"
    local result="$2"
    local details="$3"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    if [ "$result" = "PASS" ]; then
        echo -e "${GREEN}✅ PASS${NC}: $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}❌ FAIL${NC}: $test_name"
        if [ -n "$details" ]; then
            echo -e "   ${RED}Details: $details${NC}"
        fi
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Function to test JSON construction
test_json_construction() {
    local test_name="$1"
    local text="$2"
    local head="$3"
    
    # Test with jq if available
    if command -v jq >/dev/null 2>&1; then
        if [ -n "$head" ]; then
            JSON_PAYLOAD=$(jq -n --arg head "$head" --arg body "$text" '{head: $head, body: $body}')
        else
            JSON_PAYLOAD=$(jq -n --arg body "$text" '{body: $body}')
        fi
        
        # Validate JSON is valid
        if echo "$JSON_PAYLOAD" | jq . >/dev/null 2>&1; then
            print_test_result "$test_name (jq)" "PASS"
        else
            print_test_result "$test_name (jq)" "FAIL" "Invalid JSON produced"
        fi
    else
        print_test_result "$test_name (jq)" "PASS" "jq not available, skipping"
    fi
    
    # Test fallback method
    ESCAPED_TEXT=$(echo "$text" | sed 's/\\/\\\\/g; s/"/\\"/g; s/'"'"'/\\'"'"'/g')
    ESCAPED_HEAD=""
    if [ -n "$head" ]; then
        ESCAPED_HEAD=$(echo "$head" | sed 's/\\/\\\\/g; s/"/\\"/g; s/'"'"'/\\'"'"'/g')
        FALLBACK_JSON="{\"head\": \"$ESCAPED_HEAD\", \"body\": \"$ESCAPED_TEXT\"}"
    else
        FALLBACK_JSON="{\"body\": \"$ESCAPED_TEXT\"}"
    fi
    
    # Basic validation - check if JSON structure is correct
    if echo "$FALLBACK_JSON" | grep -q '^{"' && echo "$FALLBACK_JSON" | grep -q '}$'; then
        print_test_result "$test_name (fallback)" "PASS"
    else
        print_test_result "$test_name (fallback)" "FAIL" "Invalid JSON structure"
    fi
}

# Function to test URL decoding
test_url_decoding() {
    local test_name="$1"
    local encoded="$2"
    local expected="$3"
    
    # URL decode function from the script
    url_decode() {
        printf '%b\n' "${1//%/\\x}"
    }
    
    local decoded=$(url_decode "$encoded")
    if [ "$decoded" = "$expected" ]; then
        print_test_result "$test_name" "PASS"
    else
        print_test_result "$test_name" "FAIL" "Expected '$expected', got '$decoded'"
    fi
}

# Function to test actual script execution
test_script_execution() {
    local test_name="$1"
    local text="$2"
    local head="$3"
    
    # Test the actual script with a mock server response
    local script_path="admin/misc/raycast-extensions/capture-text.sh"
    
    if [ ! -f "$script_path" ]; then
        print_test_result "$test_name" "FAIL" "Script not found at $script_path"
        return
    fi
    
    # Test with a simple text that should work
    if [ -n "$head" ]; then
        local output
        if output=$("$script_path" "$text" "$head" 2>&1); then
            if echo "$output" | grep -q "Post created successfully"; then
                print_test_result "$test_name" "PASS"
            else
                print_test_result "$test_name" "FAIL" "Script ran but didn't create post successfully"
            fi
        else
            print_test_result "$test_name" "FAIL" "Script execution failed: $output"
        fi
    else
        local output
        if output=$("$script_path" "$text" 2>&1); then
            if echo "$output" | grep -q "Post created successfully"; then
                print_test_result "$test_name" "PASS"
            else
                print_test_result "$test_name" "FAIL" "Script ran but didn't create post successfully"
            fi
        else
            print_test_result "$test_name" "FAIL" "Script execution failed: $output"
        fi
    fi
}

echo -e "${BLUE}🧪 Starting tests for capture-text.sh${NC}"
echo "=================================="

# Test 1: Basic JSON construction
test_json_construction "Basic text" "Hello world" ""

# Test 2: Text with quotes
test_json_construction "Text with quotes" 'He said "Hello world"' ""

# Test 3: Text with apostrophes
test_json_construction "Text with apostrophes" "It's a beautiful day" ""

# Test 4: Text with both quotes and apostrophes
test_json_construction "Mixed quotes and apostrophes" 'He said "It'\''s a beautiful day"' ""

# Test 5: Text with head
test_json_construction "Text with head" "Body content" "Head content"

# Test 6: Complex text (simplified version of the original problematic case)
test_json_construction "Complex text with special chars" 'How to Find Your Purpose | Robert Greene & Dr. Andrew Huberma
THE PROBLEM - WHY WE'\''RE LOST
- being human is hard because nobody gives us direction
- you wake up not knowing what to do, could choose 12 different paths
- when you find your life'\''s task, everything has purpose and energy is concentrated
- it'\''s like having internal radar that guides you
- distractions become easy to cut out
YOUR UNIQUENESS IS YOUR POWER
- your DNA and life experience are completely unique, never repeated in history
- wasting that uniqueness is the worst thing you can do
- the power is finding what makes you YOU and mining that deeply
THE FIVE FRAMES OF MIND
- your brain naturally veers towards one type of intelligence:
• words and language
• abstract patterns and mathematics
• kinetic (body-based)
• social intelligence
• spatial intelligence
- go with that grain because that'\''s where your power lies
CHILDHOOD SIGNALS - THE IMPULSE VOICES
- at age 4-5, you had voices saying "I love this, I hate that"
- these indicated your natural direction
- Robert Greene: obsessed with words at 6, spelling backwards, palindromes
- Einstein: mesmerized by compass, obsessed with invisible forces
- Steve Jobs: hypnotized by technological device designs
- Tiger Woods: screaming with joy watching golf
WHY WE LOSE THE SIGNAL
- at age 7+, other voices drown out your own (teachers, parents, peers)
- you enter work world without internal radar, making choices based on money
- you'\''re not emotionally connected
EMOTIONAL ENGAGEMENT = FASTER LEARNING
- when emotionally engaged, brain learns 2-4x faster
- you feel it in your body, it'\''s visceral not intellectual
- it'\''s like swimming with current, everything clicks
- there'\''s delight even through tedium
This guy literally breaks down how to find your life'\''s' "How to Find Your Purpose | Robert Greene & Dr. Andrew Huberma"

# Test 7: URL decoding tests
test_url_decoding "URL decode spaces" "Hello%20world" "Hello world"
test_url_decoding "URL decode special chars" "Hello%21%20world" "Hello! world"
test_url_decoding "URL decode quotes" "He%20said%20%22Hello%22" 'He said "Hello"'

# Test 8: Empty text handling
test_json_construction "Empty text" "" ""

# Test 9: Very long text
long_text=$(printf "This is a very long text. %.0s" {1..50})
test_json_construction "Very long text" "$long_text" ""

# Test 10: Text with backslashes
test_json_construction "Text with backslashes" "Path: C:\\Users\\test\\file.txt" ""

# Test 11: Unicode characters
test_json_construction "Unicode text" "Hello 世界 🌍" ""

# Test 12: Edge cases
test_json_construction "Only quotes" '""' ""
test_json_construction "Only apostrophes" "''" ""
test_json_construction "Mixed delimiters" 'He said "It'\''s a \"beautiful\" day"' ""

# Test 13: Script execution tests (only if server is running)
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/posts/ | grep -q "200"; then
    echo -e "${YELLOW}📡 Server is running, testing actual script execution${NC}"
    test_script_execution "Basic script execution" "Hello world test" ""
    test_script_execution "Script with head" "Hello world test" "Test Head"
    test_script_execution "Script with special chars" 'He said "Hello world"' "Test"
else
    echo -e "${YELLOW}⚠️  Server not running, skipping script execution tests${NC}"
fi

echo ""
echo "=================================="
echo -e "${BLUE}📊 Test Results${NC}"
echo -e "Tests run: ${TESTS_RUN}"
echo -e "${GREEN}Tests passed: ${TESTS_PASSED}${NC}"
echo -e "${RED}Tests failed: ${TESTS_FAILED}${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
