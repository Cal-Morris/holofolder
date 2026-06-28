import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".cache/**",
    ".next/**",
    ".swc/**",
    ".vercel/**",
    ".worktrees/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "tsconfig.tsbuildinfo",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
])

export default eslintConfig
