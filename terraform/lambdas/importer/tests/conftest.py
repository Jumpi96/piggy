import sys
from pathlib import Path

# Make `importer` and `lambda_function` importable the way the Lambda runtime sees them.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

FIXTURES = Path(__file__).resolve().parent / "fixtures"
