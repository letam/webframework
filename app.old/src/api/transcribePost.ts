import { BACKEND_HOST } from "./constants";
import { csrfToken } from "./csrf";

export async function transcribePost(postId: number): Promise<Response> {
  const token = await csrfToken.fetchCsrfToken();

  return fetch(`${BACKEND_HOST}/api/posts/${postId}/transcribe/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": token,
    },
  });
}