import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";

import getPosts from "../api/getPosts";
import Post from "../components/Post";
import LoadingOrError from "../components/LoadingOrError";

export default function PostList(): ReactElement {
  const { isLoading, isError, error, data } = useQuery({
    queryKey: ["posts"],
    queryFn: getPosts,
  });
  if (isLoading || isError) {
    return <LoadingOrError error={error as Error} />;
  }

  return (
    <div className="mt-4 max-w-2xl mx-auto px-4">
      {data?.map((post) => (
        <Post key={`PostCard-${post.id}`} post={post} />
      ))}
    </div>
  );
}
