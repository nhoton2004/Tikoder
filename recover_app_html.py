import json
import os

transcript_path = "/home/nho/.gemini/antigravity/brain/a0fa5256-1cc8-4996-a107-36d8e37c5cb5/.system_generated/logs/transcript.jsonl"
app_html_path = "/home/nho/TikTokOrderApp/public/app.html"
recovered_path = "/home/nho/TikTokOrderApp/public/app.html.recovered"

if not os.path.exists(app_html_path):
    print("Error: base app.html not found.")
    exit(1)

with open(app_html_path, "r", encoding="utf-8") as f:
    content = f.read()

steps_to_apply = []
with open(transcript_path, "r", encoding="utf-8") as f:
    for line in f:
        try:
            step = json.loads(line)
            idx = step.get("step_index")
            # We apply all steps up to step 2220 (the last edit to app.html before the checkout)
            if idx is not None and idx <= 2220:
                tcs = step.get("tool_calls", [])
                for tc in tcs:
                    if tc.get("name") in ["replace_file_content", "multi_replace_file_content"]:
                        args = tc.get("args", {})
                        if isinstance(args, str):
                            try:
                                args = json.loads(args)
                            except:
                                pass
                        if isinstance(args, dict) and "app.html" in args.get("TargetFile", ""):
                            steps_to_apply.append((idx, tc.get("name"), args))
        except Exception as e:
            pass

# Sort steps by index
steps_to_apply.sort(key=lambda x: x[0])

print(f"Found {len(steps_to_apply)} steps to apply to public/app.html")

for idx, name, args in steps_to_apply:
    print(f"Applying step {idx} ({name})...")
    if name == "replace_file_content":
        target = args.get("TargetContent")
        repl = args.get("ReplacementContent")
        if target in content:
            content = content.replace(target, repl, 1)
            print(f"  Successfully applied step {idx}")
        else:
            # Try with carriage return normalization or check if already matches
            normalized_target = target.replace("\r\n", "\n")
            normalized_content = content.replace("\r\n", "\n")
            if normalized_target in normalized_content:
                normalized_content = normalized_content.replace(normalized_target, repl.replace("\r\n", "\n"), 1)
                content = normalized_content
                print(f"  Successfully applied step {idx} (normalized newlines)")
            else:
                print(f"  Warning: target for step {idx} not found in content!")
                print(f"  Target snippet: {repr(target[:100])}")
    elif name == "multi_replace_file_content":
        chunks = args.get("ReplacementChunks", [])
        if isinstance(chunks, str):
            try:
                chunks = json.loads(chunks)
            except:
                pass
        for chunk in chunks:
            if isinstance(chunk, str):
                try:
                    chunk = json.loads(chunk)
                except:
                    pass
            if not isinstance(chunk, dict):
                print(f"  Warning: chunk is not a dictionary: {repr(chunk)}")
                continue
            target = chunk.get("TargetContent")
            repl = chunk.get("ReplacementContent")
            if not target or not repl:
                continue
            if target in content:
                content = content.replace(target, repl, 1)
                print(f"  Successfully applied multi-chunk")
            else:
                normalized_target = target.replace("\r\n", "\n")
                normalized_content = content.replace("\r\n", "\n")
                if normalized_target in normalized_content:
                    normalized_content = normalized_content.replace(normalized_target, repl.replace("\r\n", "\n"), 1)
                    content = normalized_content
                    print(f"  Successfully applied multi-chunk (normalized newlines)")
                else:
                    print(f"  Warning: target for chunk not found in content!")
                    print(f"  Target snippet: {repr(target[:100])}")

with open(recovered_path, "w", encoding="utf-8") as f:
    f.write(content)

print(f"Saved recovered file to: {recovered_path}")
