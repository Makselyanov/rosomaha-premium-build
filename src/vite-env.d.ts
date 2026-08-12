/// <reference types="vite/client" />

declare module "virtual:canonical-articles" {
  import type { Article } from "@/data/articles";

  const articles: Article[];
  export default articles;
}
