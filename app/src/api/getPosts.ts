import type { IPost } from "../types";
import { BACKEND_HOST } from "../api/constants";

export default async function getPosts(): Promise<IPost[]> {
  const response = await fetch(`${BACKEND_HOST}/api/posts/`);

  const posts = await response.json() as IPost[];

  // Get signed url for each post
  const getPostSignedUrl = async (postId: number) => {
    const response = await fetch(`${BACKEND_HOST}/api/uploads/presign/${postId}/`);
    return response.json();
  };
  // TODO: If signed url is was recently generated, then don't request again and use the cached value
  // TODO: Have single endpoint request for all signed urls
  const postsWithSignedUrl = await Promise.all(posts.map(async (post) => {
    if (post.audio_s3_file_key) {
      const response = await getPostSignedUrl(post.id) as { url: string };
      // TODO: Cache the signed url
      return { ...post, signedAudioUrl: response.url } as IPost;
    }
    return post;
  }));
  return postsWithSignedUrl;
}
