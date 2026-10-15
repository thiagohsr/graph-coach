// One import line per `*.admin.ts` file. Importing a file registers its models (side effect of `registerAdmin`).
// Adding a model: add its declaration to the feature's `*.admin.ts` (or a new file plus a line here).
import '../accounts/accounts.admin';
import '../curator/curator.admin';
import '../puzzles/puzzles.admin';
import '../coach/coach.admin';
