import json
import os
import subprocess
import codecs

transcript_path = "/home/nho/.gemini/antigravity/brain/a0fa5256-1cc8-4996-a107-36d8e37c5cb5/.system_generated/logs/transcript.jsonl"
app_html_path = "/home/nho/TikTokOrderApp/public/app.html"
recovered_path = "/home/nho/TikTokOrderApp/public/app.html.recovered_fixed"

if not os.path.exists(app_html_path):
    print("Error: base app.html not found.")
    exit(1)

with open(app_html_path, "r", encoding="utf-8") as f:
    content = f.read()

def unescape_string(s):
    if not s:
        return ""
    # Unicode escape handles \\n -> \n, \\" -> ", etc.
    try:
        # We need to handle string that is double escaped.
        # unicode_escape decode requires bytes.
        # It converts backslash sequences.
        val = codecs.escape_decode(bytes(s, "utf-8"))[0].decode("utf-8")
        # Strip outer quotes (both single and double) that might be added as part of formatting
        while len(val) >= 2 and ((val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'"))):
            val = val[1:-1]
        return val
    except Exception as e:
        return s

steps_to_apply = []
with open(transcript_path, "r", encoding="utf-8") as f:
    for line in f:
        try:
            step = json.loads(line)
            idx = step.get("step_index")
            if idx is not None and idx <= 2220:
                tcs = step.get("tool_calls", [])
                for tc in tcs:
                    if tc.get("name") in ["replace_file_content", "multi_replace_file_content"]:
                        args = tc.get("args", {})
                        if isinstance(args, str):
                            try:
                                args = json.loads(args, strict=False)
                            except:
                                pass
                        if isinstance(args, dict) and "app.html" in args.get("TargetFile", ""):
                            steps_to_apply.append((idx, tc.get("name"), args))
        except Exception as e:
            pass

steps_to_apply.sort(key=lambda x: x[0])
print(f"Found {len(steps_to_apply)} steps to apply")

success_count = 0
warning_count = 0

for idx, name, args in steps_to_apply:
    if name == "replace_file_content":
        target = unescape_string(args.get("TargetContent"))
        repl = unescape_string(args.get("ReplacementContent"))
        
        if not target or not repl:
            continue
            
        target_norm = target.replace("\r\n", "\n")
        repl_norm = repl.replace("\r\n", "\n")
        content_norm = content.replace("\r\n", "\n")
        
        if target_norm in content_norm:
            content = content_norm.replace(target_norm, repl_norm, 1)
            success_count += 1
            print(f"Step {idx}: Success")
        else:
            # Let's try matching with some variations (like stripping outer quotes)
            warning_count += 1
            print(f"Step {idx}: Warning - Target not found! Target snippet: {repr(target_norm[:100])}")
            
    elif name == "multi_replace_file_content":
        chunks = args.get("ReplacementChunks", [])
        if isinstance(chunks, str):
            try:
                chunks = json.loads(chunks, strict=False)
            except:
                pass
        for chunk in chunks:
            if isinstance(chunk, str):
                try:
                    chunk = json.loads(chunk, strict=False)
                except:
                    pass
            if not isinstance(chunk, dict):
                continue
            target = unescape_string(chunk.get("TargetContent"))
            repl = unescape_string(chunk.get("ReplacementContent"))
            
            if not target or not repl:
                continue
                
            target_norm = target.replace("\r\n", "\n")
            repl_norm = repl.replace("\r\n", "\n")
            content_norm = content.replace("\r\n", "\n")
            
            if target_norm in content_norm:
                content = content_norm.replace(target_norm, repl_norm, 1)
                success_count += 1
                print(f"Step {idx} (multi): Success")
            else:
                warning_count += 1
                print(f"Step {idx} (multi): Warning - Target not found! Target snippet: {repr(target_norm[:100])}")

with open(recovered_path, "w", encoding="utf-8") as f:
    f.write(content)

print(f"Saved to {recovered_path}. Success: {success_count}, Warning: {warning_count}")
