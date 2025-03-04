import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Header from '../Header';
import { AuthContextProvider } from '../../contexts/auth';
import { ThemeProvider } from '../../contexts/ThemeContext';

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

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the auth API
vi.mock('../../api/auth', () => ({
  fetchAuthStatus: vi.fn().mockResolvedValue({
    is_authenticated: false,
    user: null
  })
}));

// Mock the auth context
const mockUseAuthContext = vi.fn();
vi.mock('../../contexts/auth', async () => {
  const actual = await vi.importActual('../../contexts/auth');
  return {
    ...actual,
    useAuthContext: () => mockUseAuthContext()
  };
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

// Mock the CSRF token API
vi.mock('../../api/csrf', () => ({
  fetchCsrfToken: vi.fn().mockResolvedValue('mock-csrf-token')
}));

describe('Header', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    mockFetch.mockReset();
    mockUseAuthContext.mockReturnValue({
      isInitialized: true,
      isAuthenticated: false,
      user: { username: 'testuser' }
    });
    mockUseTheme.mockReturnValue({
      isDarkMode: false,
      toggleDarkMode: vi.fn()
    });
  });

  const renderHeader = async () => {
    let result;
    await act(async () => {
      result = render(
        <BrowserRouter>
          <AuthContextProvider>
            <ThemeProvider>
              <Header />
            </ThemeProvider>
          </AuthContextProvider>
        </BrowserRouter>
      );
    });
    return result;
  };

  it('renders all navigation elements', async () => {
    await renderHeader();

    // Check if logo is present and focusable
    const logo = screen.getByRole('link', { name: /wut/i });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('tabindex', '0');

    // Check if login link is present and focusable
    const loginLink = screen.getByRole('link', { name: /login/i });
    expect(loginLink).toBeInTheDocument();
    expect(loginLink).toHaveAttribute('tabindex', '0');

    // Check if theme toggle is present
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument();
  });

  it('applies focus styles when elements are focused', async () => {
    await renderHeader();

    const logo = screen.getByRole('link', { name: /wut/i });
    const loginLink = screen.getByRole('link', { name: /login/i });

    // Check if focus styles are applied
    expect(logo).toHaveClass('focus:ring-2', 'focus:ring-blue-500');
    expect(loginLink).toHaveClass('focus:ring-2', 'focus:ring-blue-500');
  });
});