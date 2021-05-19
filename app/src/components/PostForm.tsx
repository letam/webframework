import createPost from "api/createPost";
import React, { ReactElement, useState, useCallback } from "react";

export default function PostForm(): ReactElement {
  const [form, setForm] = useState({
    head: "",
    body: "",
  });

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      createPost(form)
        .then(() => {
          window.location.reload();
        })
        .catch((error) => {
          console.error(error); // eslint-disable-line no-console
          // TODO: Display error message to user
        });
    },
    [form]
  );

  return (
    <>
      <div>
        <h1 style={{ margin: "16px" }}>Wut?</h1>
        <hr />
        <div style={{ margin: "16px" }}>
          <form onSubmit={handleSubmit}>
            <p>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label htmlFor="head">Wut up</label>
              <br />
              <textarea
                id="head"
                value={form.head}
                onChange={(event) =>
                  setForm((state) => ({ ...state, head: event.target.value }))
                }
              />
            </p>
            <p>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label htmlFor="body">More details</label>
              <br />
              <textarea
                id="body"
                value={form.body}
                onChange={(event) =>
                  setForm((state) => ({ ...state, body: event.target.value }))
                }
              />
            </p>
            <p>
              <button type="submit">Send</button>
            </p>
          </form>
        </div>
      </div>
    </>
  );
}
