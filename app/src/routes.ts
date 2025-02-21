import { lazy } from "react";

import PageNotFound from "./pages/PageNotFound";
import PWADemo from "./pages/PWADemo";
const Index = lazy(async () => import("./pages/Index"));
const Login = lazy(async () => import("./pages/Login"));
const FruitDetails = lazy(async () => import("./pages/FruitDetails"));
const FruitGallery = lazy(async () => import("./pages/FruitGallery"));

const routes = [
  {
    path: "/",
    component: Index,
    exact: true,
  },
  {
    path: "*",
    component: PageNotFound,
  },
  {
    path: "/demo",
    component: PWADemo,
  },
  {
    path: "/login",
    component: Login,
    exact: true,
  },
  {
    path: "/fruits",
    component: FruitGallery,
    exact: true,
  },
  {
    path: "/:fruitName",
    component: FruitDetails,
  },
];

export default routes;
