import type { ReactElement } from "react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import createPost from "../api/createPost";

export default function PostForm(): ReactElement {
  const queryClient = useQueryClient();
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
    <div style={{ margin: "16px" }}>
      <form onSubmit={handleSubmit}>
        <p>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="head">Wut up</label>
          <br />
          <textarea
            className="w-full p-3 border rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"

            id="head"
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
          />
        </p>
        <p style={{ display: "none" }}>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="body">More details</label>
          <br />
          <textarea
            className="dark:bg-gray-900"
            id="body"
            value={form.body}
            onChange={(event) =>
              setForm((state) => ({ ...state, body: event.target.value }))
            }
          />
        </p>
        <p>
          <button
            type="submit"
            className="px-4 py-2 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:bg-indigo-800 md:px-5 md:text-lg "
          >
            Send
          </button>
        </p>
      </form>
    </div>
  );
}
