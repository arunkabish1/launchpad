import json


def handler(event, context):
    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(
            {"message": "Hello from AWS Lambda (Python)!", "path": event.get("path", "")}
        ),
    }
