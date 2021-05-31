import { IPost } from "types";

const BACKEND_HOST = (import.meta.env.VITE_BACKEND_HOST as string) || "";

export default async function createPost(data: {
  head: string;
  body: string;
}): Promise<IPost> {
  return (
    await fetch(`${BACKEND_HOST}/api/posts/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(data),
    })
  ).json() as Promise<IPost>;
}
