import test from "node:test";
import assert from "node:assert/strict";
import { convertBiaoriLessons, convertBiaoriWord } from "../scripts/biaori-converter.mjs";

test("biaori rows become stable course words without inventing accent or unknown readings", () => {
  const rows = [
    [0, "[名]", "中国人", "ちゅうごくじん(中国人)", [0, 1]],
    [1, "[名]", "书", "ほん(本)", [1, 2]],
    [1, "/", "/", "～様", [0, 0]],
    [10000, "/", "～种，～类", "～<span superscript='しゅ'>種</span><span superscript='るい'>類</span>", [0, 0]],
  ];
  const { units, review } = convertBiaoriLessons(rows);
  assert.deepEqual(units.map(({ id, words }) => [id, words.length]), [["unit-biaori-b1-l2", 2], ["unit-biaori-b2-l1", 1]]);
  assert.deepEqual(units[0].words[0], { id: "word-biaori-1", japanese: "本", kana: "ほん", accent: "待校对", meaning: "书" });
  assert.deepEqual(units[0].words[1], { id: "word-biaori-2", japanese: "～様", kana: "待校对", accent: "待校对", meaning: "待校对" });
  assert.deepEqual(units[1].words[0], { id: "word-biaori-3", japanese: "～種類", kana: "しゅるい", accent: "待校对", meaning: "～种，～类" });
  assert.ok(review.some((item) => item.wordId === "word-biaori-2" && item.flags.length >= 2));
});

test("variants keep the source writing and mark the first reading for review", () => {
  const { word, flags } = convertBiaoriWord([208, "[形1]", "咸", "しおからい(塩辛い)／しょっぱい", [0, 0]], 42);
  assert.equal(word.japanese, "しおからい(塩辛い)／しょっぱい");
  assert.equal(word.kana, "しおからい");
  assert.ok(flags.some((flag) => flag.includes("多种写法")));
});
