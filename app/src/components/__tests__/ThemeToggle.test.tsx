import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '../ThemeToggle';
import { ThemeProvider, useTheme } from '../../contexts/ThemeContext';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  clear: vi.fn(),
  removeItem: vi.fn(),
  length: 0,
  key: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock the theme context
const mockUseTheme = vi.fn();
vi.mock('../../contexts/ThemeContext', async () => {
  const actual = await vi.importActual('../../contexts/ThemeContext');
  return {
    ...actual,
    useTheme: () => mockUseTheme()
  };
});

describe('ThemeToggle', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    mockUseTheme.mockReturnValue({
      isDarkMode: false,
      toggleDarkMode: vi.fn()
    });
  });

  const renderThemeToggle = () => {
    return render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );
  };

  it('renders theme toggle button with correct accessibility attributes', () => {
    renderThemeToggle();

    const button = screen.getByRole('button', { name: /switch to dark mode/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('tabindex', '0');
    expect(button).toHaveAttribute('aria-label', 'Switch to dark mode');
  });

  it('applies focus styles when button is focused', () => {
    renderThemeToggle();

    const button = screen.getByRole('button', { name: /switch to dark mode/i });
    expect(button).toHaveClass('focus:ring-2', 'focus:ring-blue-500');
  });

  it('handles keyboard events correctly', () => {
    const mockToggleDarkMode = vi.fn();
    mockUseTheme.mockReturnValue({
      isDarkMode: false,
      toggleDarkMode: mockToggleDarkMode
    });

    renderThemeToggle();

    const button = screen.getByRole('button', { name: /switch to dark mode/i });

    // Test Enter key
    fireEvent.keyDown(button, { key: 'Enter', preventDefault: vi.fn() });
    expect(mockToggleDarkMode).toHaveBeenCalledTimes(1);

    // Test Space key
    fireEvent.keyDown(button, { key: ' ', preventDefault: vi.fn() });
    expect(mockToggleDarkMode).toHaveBeenCalledTimes(2);

    // Test other key (should not trigger)
    fireEvent.keyDown(button, { key: 'a', preventDefault: vi.fn() });
    expect(mockToggleDarkMode).toHaveBeenCalledTimes(2);
  });
});