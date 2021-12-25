import { IFruit } from "types";

export default async function getFruits(): Promise<IFruit[]> {
  const response = await fetch("/fruits.json");
  return response.json() as Promise<IFruit[]>;
}
