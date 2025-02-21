import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";

import getPosts from "../api/getPosts";
import Post from "../components/Post";
import LoadingOrError from "../components/LoadingOrError";

import type { IPost } from "../types";

function getIdFromRecord(record: IPost): string {
  const indexOfId = 1;
  return record.url.split("/").reverse()[indexOfId];
}

export default function PostList(): ReactElement {
  const { isLoading, isError, error, data } = useQuery({
    queryKey: ["posts"],
    queryFn: getPosts,
  });
  if (isLoading || isError) {
    return <LoadingOrError error={error as Error} />;
  }

  return (
    <div>
      {data?.map((post) => (
        <Post key={`PostCard-${getIdFromRecord(post)}`} post={post} />
      ))}
    </div>
  );
}
