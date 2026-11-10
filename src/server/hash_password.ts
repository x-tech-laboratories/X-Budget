// Adds or replaces a user's line in the accounts file X_BUDGET_PASSWORD_HASH_FILE names, through X-Libs' hash-password
// command, which asks at a terminal or reads stdin so the password never lands in argv or shell history.

import { hash_password_command } from "@x-tech-laboratories/x-libs/server/hash_password";

await hash_password_command("X_BUDGET_PASSWORD_HASH_FILE");
