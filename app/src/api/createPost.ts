import { IDetailResponse, IPost } from "types";
import { BACKEND_HOST } from "api/constants";

export default async function createPost(data: {
  head: string;
  body: string;
}): Promise<IPost> {
  const response = await fetch(`${BACKEND_HOST}/api/posts/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(data),
  });
  if (response.status !== 201) {
    const responseBody = (await response.json()) as IDetailResponse;
    throw new Error(responseBody.detail);
  }
  return response.json() as Promise<IPost>;
}
