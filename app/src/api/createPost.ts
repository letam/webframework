import type { IDetailResponse, IPost } from "../types";
import { BACKEND_HOST } from "./constants";
import { csrfToken } from "./csrf";

export default async function createPost(data: FormData): Promise<IPost> {
  const response = await fetch(`${BACKEND_HOST}/api/posts/`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken.token,
    },
    body: data,
  });
  if (response.status !== 201) {
    const responseBody = (await response.json()) as IDetailResponse;
    throw new Error(responseBody.detail);
  }
  return response.json() as Promise<IPost>;
}
