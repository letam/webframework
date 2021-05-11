import getPosts from "api/getPosts";
import Post from "components/Post";
import Head from "components/Head";
import LoadingOrError from "components/LoadingOrError";
import React, { ReactElement } from "react";
import { useQuery } from "react-query";

export default function Index(): ReactElement {
  const { isLoading, isError, error, data } = useQuery("posts", getPosts);
  if (isLoading || isError) {
    return <LoadingOrError error={error as Error} />;
  }

  return (
    <>
      <Head title="Vitamin" />
      <div>
        {data?.map((post) => (
          <Post key={`PostCard-${post.id}`} post={post} />
        ))}
      </div>
    </>
  );
}
