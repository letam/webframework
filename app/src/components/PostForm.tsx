import type { ReactElement } from "react";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import createPost from "../api/createPost";

export default function PostForm(): ReactElement {
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState({
    head: "",
    body: "",
  });

  function submitForm(): void {
    if (form.head.trim() === "") {
      return;
    }
    createPost(form)
      .then(() => {
        setForm({ head: "", body: "" }); // Reset form
        queryClient.invalidateQueries({ queryKey: ["posts"] }); // Trigger posts refetch
        textareaRef.current?.focus(); // Refocus textarea after submission
      })
      .catch((error) => {
        console.error(error); // eslint-disable-line no-console
        // TODO: Display error message to user
      });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitForm();
  }

  return (
    <div className="mt-8 max-w-2xl mx-auto px-4">
      <form onSubmit={handleSubmit} role="form" aria-label="Create new post">
        <div className="space-y-2">
          <div className="space-y-2">
            <label htmlFor="head" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              What's on your mind?
            </label>
            <textarea
              ref={textareaRef}
              className="w-full p-4 border rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
              id="head"
              name="head"
              value={form.head}
              onChange={(event) =>
                setForm((state) => ({ ...state, head: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.code === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submitForm();
                }
              }}
              placeholder="Share your thoughts..."
              aria-label="Post content"
              tabIndex={1}
              rows={3}
            />
          </div>
          <div style={{ display: "none" }}>
            <label htmlFor="body" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              More details
            </label>
            <textarea
              className="dark:bg-gray-900"
              id="body"
              name="body"
              value={form.body}
              onChange={(event) =>
                setForm((state) => ({ ...state, body: event.target.value }))
              }
              aria-label="Additional post details"
              tabIndex={-1}
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="w-full sm:w-auto px-6 py-3 text-base font-medium rounded-xl shadow-sm text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              tabIndex={2}
            >
              Send
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
