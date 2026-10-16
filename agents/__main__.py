"""VAmPI baseline inspection and one real recovery candidate at a time."""
import argparse
import json
import os
from pathlib import Path

from agents.api import RunApi
from agents.config import load_target, manifest_issues
from agents.crew import STRATEGIES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['plan', 'create-run', 'run'])
    parser.add_argument('--target', type=Path, required=True)
    parser.add_argument('--api-url', default=os.getenv('RESTORELAB_API_URL'))
    parser.add_argument('--target-url')
    parser.add_argument('--run-id')
    parser.add_argument('--finding-id')
    parser.add_argument('--strategy', choices=STRATEGIES, default='guard')
    parser.add_argument('--previous-baseline-evidence')
    parser.add_argument('--output', type=Path, default=Path('.data/agent-runtime'))
    args = parser.parse_args()
    issues = manifest_issues(args.target)
    if args.mode == 'plan':
        print(json.dumps({'liveReady': not issues, 'missingManifestInputs': issues, 'externalCalls': False,
                          'note': 'A valid manifest still requires credentials, backend approval, and live measurement.'}, indent=2))
        return 1 if issues else 0
    if issues:
        parser.error('incomplete canonical manifest; run plan for exact missing inputs')
    target = load_target(args.target)
    if not args.api_url:
        parser.error('RESTORELAB_API_URL or --api-url is required')
    api = RunApi(args.api_url)
    if args.mode == 'create-run':
        if not args.target_url:
            parser.error('--target-url is required for the authorized baseline service')
        print(json.dumps(api.create_run(target, args.target_url), indent=2))
        return 0
    missing = [key for key in ['DAYTONA_API_KEY', 'RESTORELAB_MODEL'] if not os.getenv(key)]
    if missing or not args.run_id or not args.finding_id:
        parser.error('run requires --run-id, --finding-id, DAYTONA_API_KEY, RESTORELAB_MODEL and its provider credentials; missing env: ' + ', '.join(missing))
    from daytona import Daytona
    from agents.runner import run_candidate
    run_candidate(Daytona(), api, target, args.run_id, args.finding_id, args.strategy,
                  os.environ['RESTORELAB_MODEL'], args.output, args.previous_baseline_evidence)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
