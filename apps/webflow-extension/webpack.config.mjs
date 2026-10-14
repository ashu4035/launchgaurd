import path from "path";
import { fileURLToPath } from "url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default {
  entry: "./src/index.tsx",
  output: {
    filename: "bundle.js",
    path: path.resolve(dirname, "public"),
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".json"],
    alias: {
      react: path.resolve(dirname, "node_modules/react"),
      "react-dom": path.resolve(dirname, "node_modules/react-dom"),
    },
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: "ts-loader",
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  devServer: {
    static: [{ directory: path.join(dirname, "public") }],
    compress: true,
    port: 3000,
  },
};
