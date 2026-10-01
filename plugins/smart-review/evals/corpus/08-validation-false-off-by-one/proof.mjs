// Rung 4 of the validation ladder. Imports the same module the case ships
// and exercises the behavior a plausible off-by-one P0 is about.
// Exit 0: the claim "slicePage returns the wrong count" is false. Discard it.
// If you cannot run this, the finding stays unproven and does not hard-block.
import { slicePage } from "./after.mjs";

const items = Array.from({ length: 25 }, (_, i) => i);
const page = slicePage(items, 2, 10);

if (page.length !== 10 || page[0] !== 10 || page[9] !== 19) {
  console.error("slicePage(items, 2, 10) returned", page);
  process.exit(1);
}

console.log("ok", page.length, page[0], page[9]);
