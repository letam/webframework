"""
Management command for static files operations.
"""
import os
import shutil
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.conf import settings


class Command(BaseCommand):
    help = 'Manage static files - upload, organize, and clean up'

    def add_arguments(self, parser):
        parser.add_argument(
            'action',
            choices=['upload', 'organize', 'clean', 'list', 'sync'],
            help='Action to perform on static files'
        )
        parser.add_argument(
            '--source',
            type=str,
            help='Source directory or file for upload/sync operations'
        )
        parser.add_argument(
            '--category',
            type=str,
            help='Category to organize files into (images, css, js, etc.)'
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be done without actually doing it'
        )

    def handle(self, *args, **options):
        action = options['action']
        
        if action == 'upload':
            self.upload_files(options)
        elif action == 'organize':
            self.organize_files(options)
        elif action == 'clean':
            self.clean_files(options)
        elif action == 'list':
            self.list_files(options)
        elif action == 'sync':
            self.sync_files(options)

    def upload_files(self, options):
        """Upload files from source directory to static files."""
        source = options.get('source')
        if not source:
            raise CommandError('--source is required for upload action')
        
        source_path = Path(source)
        if not source_path.exists():
            raise CommandError(f'Source path does not exist: {source_path}')
        
        static_root = Path(settings.STATIC_ROOT)
        category = options.get('category', '')
        
        if category:
            target_dir = static_root / category
        else:
            target_dir = static_root
        
        target_dir.mkdir(parents=True, exist_ok=True)
        
        if source_path.is_file():
            files_to_copy = [source_path]
        else:
            files_to_copy = list(source_path.rglob('*'))
            files_to_copy = [f for f in files_to_copy if f.is_file()]
        
        copied_count = 0
        for file_path in files_to_copy:
            if source_path.is_file():
                relative_path = file_path.name
            else:
                relative_path = file_path.relative_to(source_path)
            
            target_file = target_dir / relative_path
            target_file.parent.mkdir(parents=True, exist_ok=True)
            
            if options['dry_run']:
                self.stdout.write(f'Would copy: {file_path} -> {target_file}')
            else:
                shutil.copy2(file_path, target_file)
                self.stdout.write(f'Copied: {file_path} -> {target_file}')
            
            copied_count += 1
        
        self.stdout.write(
            self.style.SUCCESS(f'Successfully processed {copied_count} files')
        )

    def organize_files(self, options):
        """Organize static files by type into subdirectories."""
        static_root = Path(settings.STATIC_ROOT)
        
        if not static_root.exists():
            self.stdout.write('No static files directory found')
            return
        
        # File type mappings
        file_types = {
            'images': ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico'],
            'css': ['.css'],
            'js': ['.js'],
            'fonts': ['.woff', '.woff2', '.ttf', '.otf'],
            'documents': ['.pdf', '.doc', '.docx', '.txt'],
            'media': ['.mp4', '.mp3', '.wav', '.avi', '.mov'],
        }
        
        files_organized = 0
        for file_path in static_root.rglob('*'):
            if not file_path.is_file() or file_path.parent == static_root:
                continue
            
            file_ext = file_path.suffix.lower()
            target_category = None
            
            for category, extensions in file_types.items():
                if file_ext in extensions:
                    target_category = category
                    break
            
            if target_category:
                target_dir = static_root / target_category
                target_dir.mkdir(exist_ok=True)
                target_file = target_dir / file_path.name
                
                if options['dry_run']:
                    self.stdout.write(f'Would move: {file_path} -> {target_file}')
                else:
                    shutil.move(str(file_path), str(target_file))
                    self.stdout.write(f'Moved: {file_path} -> {target_file}')
                
                files_organized += 1
        
        self.stdout.write(
            self.style.SUCCESS(f'Organized {files_organized} files')
        )

    def clean_files(self, options):
        """Clean up unused or duplicate static files."""
        static_root = Path(settings.STATIC_ROOT)
        
        if not static_root.exists():
            self.stdout.write('No static files directory found')
            return
        
        # Find duplicate files by size and name
        file_info = {}
        duplicates = []
        
        for file_path in static_root.rglob('*'):
            if not file_path.is_file():
                continue
            
            file_key = (file_path.name, file_path.stat().st_size)
            if file_key in file_info:
                duplicates.append((file_info[file_key], file_path))
            else:
                file_info[file_key] = file_path
        
        if duplicates:
            self.stdout.write(f'Found {len(duplicates)} duplicate files:')
            for orig, dup in duplicates:
                if options['dry_run']:
                    self.stdout.write(f'Would remove: {dup}')
                else:
                    dup.unlink()
                    self.stdout.write(f'Removed: {dup}')
        else:
            self.stdout.write('No duplicate files found')

    def list_files(self, options):
        """List all static files with their information."""
        static_root = Path(settings.STATIC_ROOT)
        
        if not static_root.exists():
            self.stdout.write('No static files directory found')
            return
        
        files = []
        for file_path in static_root.rglob('*'):
            if file_path.is_file():
                relative_path = file_path.relative_to(static_root)
                file_url = f"{settings.STATIC_URL}{relative_path}"
                files.append({
                    'path': str(relative_path),
                    'url': file_url,
                    'size': file_path.stat().st_size,
                })
        
        files.sort(key=lambda x: x['path'])
        
        self.stdout.write(f'Found {len(files)} static files:')
        for file_info in files:
            size_mb = file_info['size'] / (1024 * 1024)
            self.stdout.write(
                f"  {file_info['path']} ({size_mb:.2f} MB) - {file_info['url']}"
            )

    def sync_files(self, options):
        """Sync files from source to static directory."""
        source = options.get('source')
        if not source:
            raise CommandError('--source is required for sync action')
        
        source_path = Path(source)
        if not source_path.exists():
            raise CommandError(f'Source path does not exist: {source_path}')
        
        static_root = Path(settings.STATIC_ROOT)
        
        if options['dry_run']:
            self.stdout.write('Dry run - would sync files:')
        
        # This is a simplified sync - in practice you might want more sophisticated logic
        self.upload_files(options)
