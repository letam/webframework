import { IPost } from "types";

export default async function getPosts(): Promise<IPost[]> {
  return (await fetch("/api/posts/")).json() as Promise<IPost[]>;
}
