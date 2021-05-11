import { IPost } from "types";

export default async function getPosts(): Promise<IPost[]> {
  return (await fetch("/posts.json")).json() as Promise<IPost[]>;
}
