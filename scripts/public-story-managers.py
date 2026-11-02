#!/usr/bin/env python3
"""Resolve a real Keycloak login and change only app story-manager assignments."""
import argparse, json, os, re, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
os.chdir(ROOT)
p=argparse.ArgumentParser()
p.add_argument('action',choices=['grant','revoke','list','audit'])
target=p.add_mutually_exclusive_group();target.add_argument('--story',type=int);target.add_argument('--all-existing',action='store_true')
p.add_argument('--username');a=p.parse_args()
if a.action in ['grant','revoke','audit'] and (not a.username or not re.fullmatch(r'[a-zA-Z0-9_-]{2,40}',a.username)):p.error('Exact Keycloak --username is required')
if a.all_existing and a.action!='grant':p.error('--all-existing is only for grant')
if a.action!='audit' and not a.all_existing and (not a.story or a.story<1):p.error('--story is required')
cfg=dict(line.split('=',1) for line in Path('deploy/.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
values=dict(action=a.action,storyId=a.story,all=a.all_existing,username=a.username,expectedIssuer=cfg['APP_ORIGIN']+'/id/realms/novel-branches',admin=cfg.get('KC_ADMIN_USER','admin'),secret=cfg['KC_ADMIN_PASSWORD'])
r=subprocess.run(['docker','compose','--env-file','deploy/.env','-f','deploy/compose.public.yaml','exec','-T','app','node','scripts/story-managers.mjs'],input=json.dumps(values),text=True,capture_output=True)
if r.returncode:
    print('Story manager operation failed: verify exact username/OIDC mapping, story and creator protection. No credentials displayed.');raise SystemExit(1)
print(r.stdout.strip())
