import { IPost } from "types";

export default async function createPost(data: {
  head: string;
  body: string;
}): Promise<IPost> {
  return (
    await fetch("/api/posts/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(data),
    })
  ).json() as Promise<IPost>;
}
