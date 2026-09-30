"""Extract the genealogy tables in sourceData into a PersonTreeItem JSON file.

The source PDF is a scanned/text-mixed table. This script intentionally keeps
records whose parent cannot be resolved as roots instead of dropping them.
"""

from __future__ import annotations

import collections
import json
import re
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "sourceData" / "0009世系表（三甲）.pdf"
OUTPUT = ROOT / "src" / "data" / "0009世系表（三甲）.json"


CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
IGNORED_CHILD_TEXT = {"一人", "二人", "三人", "四人", "五人", "六人", "七人", "八人", "九人", "十人", "共五人", "无", "后"}


def chinese_number(value: str) -> int:
    if value.isdigit():
        return int(value)
    total = 0
    unit = 0
    for char in value:
        number = CN_NUM.get(char)
        if number is None:
            continue
        if number == 10:
            total += (unit or 1) * number
            unit = 0
        else:
            unit = number
    return total + unit


def normalize(value: str | None) -> str:
    value = (value or "").replace("庞", "").replace("o", "").replace("Ｏ", "")
    value = re.sub(r"[·、，,（）()？?\s]", "", value)
    return value


def text_in_column(words, low, high, left, right):
    selected = [w for w in words if low <= w["top"] < high and left <= w["x0"] < right]
    return "".join(w["text"] for w in sorted(selected, key=lambda item: item["x0"])) or None


def line_groups(words):
    groups = []
    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        if groups and abs(word["top"] - groups[-1][0]) <= 2.5:
            groups[-1][1].append(word)
        else:
            groups.append([word["top"], [word]])
    return groups


def extract_children(words):
    names = []
    for _, row in line_groups(words):
        row = sorted(row, key=lambda item: item["x0"])
        for word in row:
            text = word["text"]
            if text == "o":
                if names:
                    names[-1] += "o"
                continue
            if text in IGNORED_CHILD_TEXT or text.startswith("下落"):
                continue
            if re.search(r"葬于|迁普|访问祖籍|派者|文林郎|岁贡|地棺|坐东向", text):
                continue
            names.append(text)
    return names


def parse_page(page, generation, carried_parent=None):
    words = page.extract_words(x_tolerance=1, y_tolerance=3)
    current = [
        word
        for word in words
        if word["top"] > 140
        and 140 <= (word["x0"] + word["x1"]) / 2 < 190
        and word["text"] != "o"
    ]
    anchors = []
    for word in current:
        if anchors and abs(word["top"] - anchors[-1]["top"]) <= 2.5:
            anchors[-1]["name"] += word["text"]
        else:
            anchors.append({"name": word["text"], "top": word["top"]})
    anchors = [anchor for anchor in anchors if anchor["name"] not in IGNORED_CHILD_TEXT]

    parent_words = sorted(
        [
            word
            for word in words
            if word["top"] > 140
            and 90 <= (word["x0"] + word["x1"]) / 2 < 135
            and word["text"] != "o"
        ],
        key=lambda item: item["top"],
    )
    result = []
    for index, anchor in enumerate(anchors):
        if any(
            word["text"] == "o"
            and abs(word["top"] - anchor["top"]) <= 2.5
            and 140 <= (word["x0"] + word["x1"]) / 2 < 200
            for word in words
        ):
            anchor["name"] += "o"
        parent_word = min(parent_words, key=lambda item: abs(item["top"] - anchor["top"])) if parent_words else None
        low = 140 if index == 0 else (anchors[index - 1]["top"] + anchor["top"]) / 2
        high = page.height - 50 if index == len(anchors) - 1 else (anchor["top"] + anchors[index + 1]["top"]) / 2
        result.append(
            {
                "generation": generation,
                "name": anchor["name"],
                "parentLabel": parent_word["text"] if parent_word else carried_parent,
                "alias": text_in_column(words, low, high, 195, 250),
                "birthDate": text_in_column(words, low, high, 235, 380),
                "spouse": text_in_column(words, low, high, 390, 465),
                "spouseDate": text_in_column(words, low, high, 490, 575),
                "children": extract_children([word for word in words if low <= word["top"] < high and 590 <= word["x0"] < 735]),
                "notes": text_in_column(words, low, high, 735, 800),
                "page": page.page_number,
            }
        )
    return result


def parse_records():
    records = [
        {
            "generation": 1,
            "name": "庞开第",
            "parentLabel": None,
            "alias": None,
            "birthDate": None,
            "spouse": "陈氏",
            "children": ["庞世爵", "庞世禄"],
            "notes": "都统制",
            "page": 1,
        },
        {
            "generation": 2,
            "name": "庞世爵",
            "parentLabel": "庞开第",
            "alias": "君重",
            "birthDate": "康熙三十六年三月二十六日",
            "spouse": "石氏",
            "spouseDate": "雍正十三年腊月二十一日",
            "children": ["间", "早", "亨", "昆", "昇"],
            "notes": None,
            "page": 1,
        },
        {
            "generation": 2,
            "name": "庞世禄",
            "parentLabel": "庞开第",
            "alias": "君灿",
            "birthDate": None,
            "spouse": "刘氏",
            "spouseDate": None,
            "children": ["明", "旭", "昭", "昱"],
            "notes": "文林郎",
            "page": 1,
        },
    ]
    carried = {}
    with pdfplumber.open(PDF) as pdf:
        for page in pdf.pages[1:]:
            heading = [word["text"] for word in page.extract_words() if word["top"] < 115 and "世祖" in word["text"]]
            if not heading:
                continue
            generation = chinese_number(heading[0].replace("世祖", ""))
            page_records = parse_page(page, generation, carried.get(generation))
            records.extend(page_records)
            parent_words = [
                word["text"]
                for word in page.extract_words()
                if word["top"] > 140
                and 90 <= (word["x0"] + word["x1"]) / 2 < 135
                and word["text"] != "o"
            ]
            if parent_words:
                carried[generation] = parent_words[-1]
    return records


def clean_name(value):
    value = value or ""
    return value.replace("\ue84f", "镏")


def make_tree(records):
    by_name = collections.defaultdict(list)
    for index, record in enumerate(records):
        record["recordId"] = index
        record["name"] = clean_name(record["name"])
        record["children"] = [clean_name(item) for item in record.get("children", [])]
        record["normalizedName"] = normalize(record["name"])
        record["normalizedAlias"] = normalize(record.get("alias"))
        record["normalizedParent"] = normalize(record.get("parentLabel"))
        by_name[(record["generation"], record["normalizedName"])].append(record)
        if record["normalizedAlias"] and record["normalizedAlias"] != record["normalizedName"]:
            by_name[(record["generation"], record["normalizedAlias"])].append(record)
    # The first extracted data page uses the abbreviated parent labels 世爵/世禄.
    first_generation_parent = {
        "庞间": "庞世爵", "庞早": "庞世爵", "庞亨": "庞世爵",
        "庞昆": "庞世爵", "庞昇": "庞世爵", "庞明": "庞世禄",
        "庞旭": "庞世禄", "庞昭": "庞世禄", "庞昱": "庞世禄",
    }
    for record in records:
        if record["generation"] == 3 and record["name"] in first_generation_parent:
            record["normalizedParent"] = normalize(first_generation_parent[record["name"]])

    def parent_candidates(record):
        if record["generation"] <= 1 or not record["normalizedParent"]:
            return []
        candidates = [
            candidate
            for candidate in records
            if candidate["generation"] == record["generation"] - 1
            and (
                candidate["normalizedName"] == record["normalizedParent"]
                or normalize(candidate.get("alias")) == record["normalizedParent"]
            )
        ]
        return sorted(candidates, key=lambda candidate: abs(candidate["recordId"] - record["recordId"]))

    parent_of = {}
    children_of = collections.defaultdict(list)
    # Parent labels are the most reliable signal, including across page breaks.
    for record in records:
        candidates = parent_candidates(record)
        if candidates:
            parent = candidates[0]
            if parent["recordId"] != record["recordId"]:
                parent_of[record["recordId"]] = parent["recordId"]
                children_of[parent["recordId"]].append(record)

    # Fill gaps from the next-generation child-name column, without reassigning
    # records already attached through an explicit parent label.
    for record in records:
        for child_name in record.get("children", []):
            normalized = normalize(child_name)
            candidates = [
                candidate
                for candidate in by_name.get((record["generation"] + 1, normalized), [])
                if candidate["recordId"] not in parent_of
            ]
            if not candidates:
                candidates = [
                    candidate
                    for candidate in records
                    if candidate["generation"] == record["generation"] + 1
                    and candidate["recordId"] not in parent_of
                    and (
                        candidate["normalizedName"].endswith(normalized)
                        or candidate["normalizedAlias"].endswith(normalized)
                    )
                ]
            if candidates:
                child = min(candidates, key=lambda candidate: abs(candidate["recordId"] - record["recordId"]))
                parent_of[child["recordId"]] = record["recordId"]
                children_of[record["recordId"]].append(child)

    person_ids = {record["recordId"]: index + 1 for index, record in enumerate(records)}
    spouse_records = [record for record in records if record.get("spouse")]
    spouse_ids = {record["recordId"]: len(records) + index + 1 for index, record in enumerate(spouse_records)}
    chinese_generations = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五"]
    visiting = set()

    def item(record, parent_id=None, as_spouse=False):
        record_id = record["recordId"]
        if record_id in visiting:
            return None
        visiting.add(record_id)
        person_id = spouse_ids[record_id] if as_spouse else person_ids[record_id]
        raw_name = clean_name(record.get("spouse")) if as_spouse else record["name"]
        marked_female = raw_name.endswith("o")
        name = raw_name[:-1] if marked_female else raw_name
        child_parent_id = person_id
        child_items = [child for child in (item(child, child_parent_id) for child in children_of.get(record_id, [])) if child]
        if not as_spouse and record.get("spouse"):
            spouse_name = clean_name(record.get("spouse"))
            spouse_marked_female = spouse_name.endswith("o")
            if spouse_marked_female:
                spouse_name = spouse_name[:-1]
            spouse_item = {
                "id": spouse_ids[record_id],
                "pId": person_id,
                "generation": f"{chinese_generations[record['generation']]}世",
                "name": spouse_name,
                "alias": None,
                "birthDate": record.get("spouseDate"),
                "deathDate": None,
                "notes": None,
                "sex": "男" if marked_female else "女",
                "type": "配偶",
                "chirdrensList": child_items or None,
            }
            child_items = [spouse_item]
        visiting.remove(record_id)
        return {
            "id": person_id,
            "pId": parent_id,
            "generation": f"{chinese_generations[record['generation']]}世",
            "name": name,
            "alias": record.get("alias"),
            "birthDate": record.get("spouseDate") if as_spouse else record.get("birthDate"),
            "deathDate": None,
            "notes": record.get("notes"),
            "sex": "女" if as_spouse or marked_female else "男",
            "type": "配偶" if as_spouse else "宗亲",
            "chirdrensList": child_items or None,
        }

    roots = [record for record in records if record["recordId"] not in parent_of]
    return [entry for record in roots if (entry := item(record))]


def main():
    records = parse_records()
    tree = make_tree(records)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(tree, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = 0
    generations = collections.Counter()

    def count(items):
        nonlocal total
        for entry in items:
            total += 1
            generations[entry["generation"]] += 1
            if entry["chirdrensList"]:
                count(entry["chirdrensList"])

    count(tree)
    print(f"wrote {OUTPUT}")
    print(f"root items: {len(tree)}; tree items: {total}; generations: {dict(generations)}")


if __name__ == "__main__":
    main()
