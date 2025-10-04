#!/usr/bin/env python3
"""
Utility script for managing static files on the server.
This provides a convenient interface for common static file operations.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import requests

# Add the server directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

# Server configuration
DEFAULT_SERVER_URL = 'http://127.0.0.1:8000'
STATIC_API_BASE = '/static'


class StaticFileManager:
    """Client for managing static files via the API."""

    def __init__(self, server_url=DEFAULT_SERVER_URL):
        self.server_url = server_url.rstrip('/')
        self.api_base = f"{self.server_url}{STATIC_API_BASE}"

    def upload_file(self, file_path, target_path=None):
        """Upload a file to the static files directory."""
        file_path = Path(file_path)
        if not file_path.exists():
            print(f"Error: File not found: {file_path}")
            return False

        if target_path is None:
            target_path = file_path.name

        url = f"{self.api_base}/upload/"

        try:
            with open(file_path, 'rb') as f:
                files = {'file': f}
                data = {'path': target_path}
                response = requests.post(url, files=files, data=data)

            if response.status_code == 200:
                result = response.json()
                print(f"✅ Uploaded: {file_path} -> {result['file_url']}")
                return True
            else:
                print(f"❌ Upload failed: {response.text}")
                return False
        except Exception as e:
            print(f"❌ Error uploading file: {e}")
            return False

    def list_files(self):
        """List all static files."""
        url = f"{self.api_base}/list/"

        try:
            response = requests.get(url)
            if response.status_code == 200:
                result = response.json()
                files = result.get('files', [])

                if not files:
                    print("No static files found.")
                    return

                print(f"Found {len(files)} static files:")
                print("-" * 80)
                for file_info in files:
                    size_mb = file_info['size'] / (1024 * 1024)
                    print(f"{file_info['path']:<40} {size_mb:>8.2f} MB  {file_info['url']}")
            else:
                print(f"❌ Failed to list files: {response.text}")
        except Exception as e:
            print(f"❌ Error listing files: {e}")

    def get_file_info(self, file_path):
        """Get information about a specific file."""
        url = f"{self.api_base}/info/{file_path}"

        try:
            response = requests.get(url)
            if response.status_code == 200:
                result = response.json()
                print(f"File: {result['path']}")
                print(f"URL: {result['url']}")
                print(f"Size: {result['size']} bytes ({result['size'] / (1024 * 1024):.2f} MB)")
                print(f"MIME Type: {result['mime_type']}")
                print(f"Modified: {result['modified']}")
            else:
                print(f"❌ File not found: {file_path}")
        except Exception as e:
            print(f"❌ Error getting file info: {e}")

    def delete_file(self, file_path):
        """Delete a static file."""
        url = f"{self.api_base}/upload/"

        try:
            data = {'path': file_path}
            response = requests.delete(url, json=data)

            if response.status_code == 200:
                print(f"✅ Deleted: {file_path}")
                return True
            else:
                print(f"❌ Delete failed: {response.text}")
                return False
        except Exception as e:
            print(f"❌ Error deleting file: {e}")
            return False

    def serve_file(self, file_path):
        """Get the URL to serve a file."""
        file_url = f"{self.server_url}{STATIC_API_BASE}/files/{file_path}"
        print(f"File URL: {file_url}")
        return file_url


def main():
    parser = argparse.ArgumentParser(description='Manage static files on the server')
    parser.add_argument('--server', default=DEFAULT_SERVER_URL, help='Server URL')

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # Upload command
    upload_parser = subparsers.add_parser('upload', help='Upload a file')
    upload_parser.add_argument('file', help='File to upload')
    upload_parser.add_argument('--target', help='Target path in static directory')

    # List command
    subparsers.add_parser('list', help='List all static files')

    # Info command
    info_parser = subparsers.add_parser('info', help='Get file information')
    info_parser.add_argument('file', help='File path')

    # Delete command
    delete_parser = subparsers.add_parser('delete', help='Delete a file')
    delete_parser.add_argument('file', help='File path to delete')

    # Serve command
    serve_parser = subparsers.add_parser('serve', help='Get file URL')
    serve_parser.add_argument('file', help='File path')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    manager = StaticFileManager(args.server)

    if args.command == 'upload':
        manager.upload_file(args.file, args.target)
    elif args.command == 'list':
        manager.list_files()
    elif args.command == 'info':
        manager.get_file_info(args.file)
    elif args.command == 'delete':
        manager.delete_file(args.file)
    elif args.command == 'serve':
        manager.serve_file(args.file)


if __name__ == '__main__':
    main()
