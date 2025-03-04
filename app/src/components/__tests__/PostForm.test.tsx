import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PostForm from "../PostForm";
import createPost from "../../api/createPost";
import type { IPost } from "../../types";

// Mock the createPost API function
vi.mock("../../api/createPost", () => ({
  default: vi.fn(),
}));

describe("PostForm", () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const mockPost: IPost = {
    url: "/api/posts/1/",
    created: "2024-03-04T00:00:00Z",
    author: {
      id: 1,
      username: "testuser",
      first_name: "Test",
      last_name: "User",
    },
    head: "Test post content",
    body: "",
  };

  // Reset mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderPostForm = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <PostForm />
      </QueryClientProvider>
    );
  };

  it("renders form elements correctly", () => {
    renderPostForm();

    // Check for form elements
    expect(screen.getByRole("form")).toBeInTheDocument();
    expect(screen.getByLabelText("What's on your mind?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("handles form submission correctly", async () => {
    const mockCreatePost = vi.mocked(createPost);
    mockCreatePost.mockResolvedValueOnce(mockPost);

    renderPostForm();

    // Get form elements
    const textarea = screen.getByLabelText("What's on your mind?");
    const submitButton = screen.getByRole("button", { name: "Send" });

    // Type some text
    await userEvent.type(textarea, "Test post content");

    // Submit the form
    await userEvent.click(submitButton);

    // Verify createPost was called with correct data
    expect(mockCreatePost).toHaveBeenCalledWith({
      head: "Test post content",
      body: "",
    });

    // Verify form was reset
    expect(textarea).toHaveValue("");
  });

  it("does not submit empty posts", async () => {
    const mockCreatePost = vi.mocked(createPost);
    renderPostForm();

    const submitButton = screen.getByRole("button", { name: "Send" });
    await userEvent.click(submitButton);

    // Verify createPost was not called
    expect(mockCreatePost).not.toHaveBeenCalled();
  });

  it("handles keyboard shortcuts correctly", async () => {
    const mockCreatePost = vi.mocked(createPost);
    mockCreatePost.mockResolvedValueOnce(mockPost);

    renderPostForm();

    const textarea = screen.getByLabelText("What's on your mind?");
    await userEvent.type(textarea, "Test post content");

    // Simulate Ctrl+Enter
    fireEvent.keyDown(textarea, {
      key: "Enter",
      code: "Enter",
      ctrlKey: true,
    });

    await waitFor(() => {
      expect(mockCreatePost).toHaveBeenCalledWith({
        head: "Test post content",
        body: "",
      });
    });
  });

  it("maintains proper tab order", async () => {
    renderPostForm();

    const textarea = screen.getByLabelText("What's on your mind?");
    const submitButton = screen.getByRole("button", { name: "Send" });

    // Focus the textarea
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    // Press Tab to move to submit button
    await userEvent.tab();
    expect(document.activeElement).toBe(submitButton);
  });

  it("handles API errors gracefully", async () => {
    const mockCreatePost = vi.mocked(createPost);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreatePost.mockRejectedValueOnce(new Error("API Error"));

    renderPostForm();

    const textarea = screen.getByLabelText("What's on your mind?");
    const submitButton = screen.getByRole("button", { name: "Send" });

    await userEvent.type(textarea, "Test post content");
    await userEvent.click(submitButton);

    expect(consoleErrorSpy).toHaveBeenCalledWith(new Error("API Error"));
    consoleErrorSpy.mockRestore();
  });

  it("renders form elements with correct accessibility attributes", () => {
    renderPostForm();

    // Check if textarea is present and has correct tabIndex
    const textarea = screen.getByRole('textbox', { name: /post content/i });
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute('tabindex', '1');

    // Check if submit button is present and has correct tabIndex
    const submitButton = screen.getByRole('button', { name: /send/i });
    expect(submitButton).toBeInTheDocument();
    expect(submitButton).toHaveAttribute('tabindex', '2');
  });

  it("maintains correct tab order", async () => {
    renderPostForm();

    // Get all focusable elements
    const textarea = screen.getByRole('textbox', { name: /post content/i });
    const submitButton = screen.getByRole('button', { name: /send/i });

    // Focus the textarea
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    // Press Tab to move to submit button
    await userEvent.tab();
    expect(document.activeElement).toBe(submitButton);
  });

  it("applies focus styles when elements are focused", () => {
    renderPostForm();

    const textarea = screen.getByRole('textbox', { name: /post content/i });
    const submitButton = screen.getByRole('button', { name: /send/i });

    // Check if focus styles are applied
    expect(textarea).toHaveClass('focus:ring-2', 'focus:ring-blue-500');
    expect(submitButton).toHaveClass('focus:ring-2', 'focus:ring-offset-2', 'focus:ring-indigo-500');
  });

  it("focuses textarea first when pressing Tab on the page", async () => {
    renderPostForm();

    // Get the textarea
    const textarea = screen.getByRole('textbox', { name: /post content/i });

    // Press Tab on the page
    await userEvent.tab();

    // Verify textarea is focused first
    expect(document.activeElement).toBe(textarea);
  });

  it("refocuses textarea after successful form submission", async () => {
    const mockCreatePost = vi.mocked(createPost);
    mockCreatePost.mockResolvedValueOnce(mockPost);

    renderPostForm();

    const textarea = screen.getByRole('textbox', { name: /post content/i });
    const submitButton = screen.getByRole('button', { name: /send/i });

    // Type some text and submit
    await userEvent.type(textarea, "Test post content");
    await userEvent.click(submitButton);

    // Verify textarea is refocused after submission
    expect(document.activeElement).toBe(textarea);
  });

  it("submits form and refocuses textarea on Cmd/Ctrl+Enter", async () => {
    const mockCreatePost = vi.mocked(createPost);
    mockCreatePost.mockResolvedValueOnce(mockPost);

    renderPostForm();

    const textarea = screen.getByRole('textbox', { name: /post content/i });
    await userEvent.type(textarea, "Test post content");

    // Simulate Cmd+Enter (macOS) or Ctrl+Enter (Windows/Linux)
    fireEvent.keyDown(textarea, {
      key: "Enter",
      code: "Enter",
      metaKey: true, // Cmd key on macOS
    });

    // Verify form was submitted
    await waitFor(() => {
      expect(mockCreatePost).toHaveBeenCalledWith({
        head: "Test post content",
        body: "",
      });
    });

    // Verify textarea is refocused
    expect(document.activeElement).toBe(textarea);
  });
});