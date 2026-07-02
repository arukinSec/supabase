#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime

def parse_chrome_history(file_path):
    """
    Parses Google Data Portability Chrome History (BrowserHistory.json).
    Returns structured activity log.
    """
    if not os.path.exists(file_path):
        return []
    
    parsed_logs = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Chrome history delivers a list of objects under 'Browser History'
            history_list = data.get('Browser History', [])
            for entry in history_list:
                url = entry.get('url', '')
                title = entry.get('title', '')
                # Timestamp is in microseconds (Unix Epoch)
                usec = entry.get('time_usec', 0)
                dt = datetime.utcfromtimestamp(usec / 1000000.0) if usec else None
                
                # Simple keyword matcher for risk analysis
                risk_flags = []
                lowered_url = url.lower()
                lowered_title = title.lower()
                for keyword in ['login', 'password', 'signin', 'bank', 'crypto', 'wallet', 'torrent', 'proxy', 'vpn', 'bypass']:
                    if keyword in lowered_url or keyword in lowered_title:
                        risk_flags.append(keyword)

                parsed_logs.append({
                    "timestamp": dt.isoformat() if dt else "Unknown",
                    "title": title,
                    "url": url,
                    "risk_flags": risk_flags,
                    "risk_level": "HIGH" if len(risk_flags) > 0 else "LOW"
                })
    except Exception as e:
        print(f"Error parsing Chrome History: {e}", file=sys.stderr)
        
    return parsed_logs


def parse_chrome_bookmarks(file_path):
    """
    Parses Google Data Portability Chrome Bookmarks (Bookmarks).
    Returns a flat list of bookmarked pages with folder hierarchy paths.
    """
    if not os.path.exists(file_path):
        return []

    parsed_bookmarks = []

    def traverse_nodes(node, current_path=""):
        if node.get('type') == 'url':
            name = node.get('name', '')
            url = node.get('url', '')
            parsed_bookmarks.append({
                "path": current_path,
                "name": name,
                "url": url
            })
        elif node.get('type') == 'folder':
            folder_name = node.get('name', '')
            children = node.get('children', [])
            new_path = f"{current_path}/{folder_name}" if current_path else folder_name
            for child in children:
                traverse_nodes(child, new_path)

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            roots = data.get('roots', {})
            # Roots can contain bookmark_bar, other, synced, etc.
            for root_key, root_node in roots.items():
                traverse_nodes(root_node, root_node.get('name', root_key))
    except Exception as e:
        print(f"Error parsing Chrome Bookmarks: {e}", file=sys.stderr)

    return parsed_bookmarks


def parse_google_search_history(file_path):
    """
    Parses Google Search History (MyActivity.json).
    Returns a clean timeline of queries.
    """
    if not os.path.exists(file_path):
        return []

    parsed_searches = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Google activity logs are delivered as a flat list
            for entry in data:
                # We only want Search activities
                header = entry.get('header', '')
                if 'search' not in header.lower():
                    continue

                title = entry.get('title', '')
                query = title.replace('Searched for ', '').strip() if title.startswith('Searched for') else title
                
                # Check for query text
                if not query:
                    continue

                # Parse timestamp (e.g. "2026-06-25T20:13:50.000Z")
                time_str = entry.get('time', '')
                
                parsed_searches.append({
                    "timestamp": time_str,
                    "query": query,
                    "raw_title": title
                })
    except Exception as e:
        print(f"Error parsing Search History: {e}", file=sys.stderr)

    return parsed_searches


def parse_play_purchases(file_path):
    """
    Parses Play Store Purchases (Purchases.json).
    Returns a structured log of apps/items bought.
    """
    if not os.path.exists(file_path):
        return []

    parsed_purchases = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Play Store purchases are listed under a top-level key or flat
            # Structure matches: [{"purchaseTime": "...", "doc": {"title": "...", "price": "..."}}]
            for entry in data:
                doc = entry.get('doc', {})
                title = doc.get('title', '')
                price = entry.get('price', {}).get('micros', 0) / 1000000.0 if 'price' in entry else 0.0
                currency = entry.get('price', {}).get('currencyCode', 'USD')
                time_str = entry.get('purchaseTime', '')

                parsed_purchases.append({
                    "timestamp": time_str,
                    "item_name": title,
                    "price": f"{price:.2f} {currency}" if price > 0 else "Free",
                    "payment_method": entry.get('paymentInstrument', {}).get('name', 'Unknown')
                })
    except Exception as e:
        print(f"Error parsing Play Store Purchases: {e}", file=sys.stderr)

    return parsed_purchases


if __name__ == "__main__":
    # Quick CLI wrapper for local verification/debugging
    if len(sys.argv) < 3:
        print("Usage: parse_takeout.py [chrome_history | bookmarks | search | play] [file_path]")
        sys.exit(1)

    command = sys.argv[1]
    path = sys.argv[2]

    if command == "chrome_history":
        res = parse_chrome_history(path)
    elif command == "bookmarks":
        res = parse_chrome_bookmarks(path)
    elif command == "search":
        res = parse_google_search_history(path)
    elif command == "play":
        res = parse_play_purchases(path)
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

    print(json.dumps(res, indent=2))
