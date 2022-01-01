import type { ReactElement } from "react";
import { useState, useCallback } from "react";

import createPost from "api/createPost";

export default function PostForm(): ReactElement {
  const [form, setForm] = useState({
    head: "",
    body: "",
  });

  const submitForm = useCallback(() => {
    if (form.head.trim() === "") {
      return;
    }
    createPost(form)
      .then(() => {
        window.location.reload();
      })
      .catch((error) => {
        console.error(error); // eslint-disable-line no-console
        // TODO: Display error message to user
      });
  }, [form]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submitForm();
    },
    [submitForm]
  );

  return (
    <div style={{ margin: "16px" }}>
      <form onSubmit={handleSubmit}>
        <p>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="head">Wut up</label>
          <br />
          <textarea
            className="dark:bg-gray-900"
            id="head"
            value={form.head}
            onChange={(event): void => {
              setForm((state) => ({ ...state, head: event.target.value }));
            }}
            onKeyDown={(event): void => {
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
            onChange={(event): void => {
              setForm((state) => ({ ...state, body: event.target.value }));
            }}
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
