import getPosts from "api/getPosts";
import Post from "components/Post";
import LoadingOrError from "components/LoadingOrError";
import React, { ReactElement } from "react";
import { useQuery } from "react-query";

export default function PostList(): ReactElement {
  const { isLoading, isError, error, data } = useQuery("posts", getPosts);
  if (isLoading || isError) {
    return <LoadingOrError error={error as Error} />;
  }

  return (
    <>
      <div>
        {data?.map((post) => (
          <Post key={`PostCard-${post.id}`} post={post} />
        ))}
      </div>
    </>
  );
}
