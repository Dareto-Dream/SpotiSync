import base64
import os
from datetime import datetime, timedelta, timezone

import httpx
from database.db import query

SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'

REQUIRED_SCOPES = ' '.join(
    [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-read-playback-state',
        'user-modify-playback-state',
        'user-read-currently-playing',
        'playlist-read-private',
        'playlist-read-collaborative',
    ]
)


def get_authorization_url(state: str):
    params = {
        'client_id': os.getenv('SPOTIFY_CLIENT_ID'),
        'response_type': 'code',
        'redirect_uri': os.getenv('SPOTIFY_REDIRECT_URI'),
        'scope': REQUIRED_SCOPES,
        'state': state or 'default',
        'show_dialog': 'false',
    }

    query_string = httpx.QueryParams(params)
    return f"{SPOTIFY_AUTH_URL}?{query_string}"


async def exchange_code_for_tokens(code: str):
    auth_string = base64.b64encode(
        f"{os.getenv('SPOTIFY_CLIENT_ID')}:{os.getenv('SPOTIFY_CLIENT_SECRET')}".encode('utf-8')
    ).decode('utf-8')

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                SPOTIFY_TOKEN_URL,
                data={
                    'grant_type': 'authorization_code',
                    'code': code,
                    'redirect_uri': os.getenv('SPOTIFY_REDIRECT_URI'),
                },
                headers={
                    'Authorization': f"Basic {auth_string}",
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            )
            response.raise_for_status()

            token_data = response.json()
            access_token = token_data['access_token']
            refresh_token = token_data['refresh_token']
            expires_in = token_data['expires_in']

            profile_response = await client.get(
                'https://api.spotify.com/v1/me',
                headers={'Authorization': f"Bearer {access_token}"},
            )
            profile_response.raise_for_status()
            profile = profile_response.json()

        user_id = profile['id']
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        await query(
            """
            INSERT INTO auth_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id)
            DO UPDATE SET
              access_token = EXCLUDED.access_token,
              refresh_token = EXCLUDED.refresh_token,
              expires_at = EXCLUDED.expires_at,
              updated_at = CURRENT_TIMESTAMP
            """,
            [user_id, access_token, refresh_token, expires_at],
        )

        return {
            'userId': user_id,
            'accessToken': access_token,
            'refreshToken': refresh_token,
            'expiresAt': expires_at,
            'profile': profile,
        }
    except Exception as exc:
        error_message = getattr(getattr(exc, 'response', None), 'text', None) or str(exc)
        print('Token exchange error:', error_message)
        raise Exception('Failed to exchange authorization code')


async def refresh_access_token(user_id: str):
    try:
        result = await query(
            'SELECT refresh_token FROM auth_tokens WHERE user_id = $1',
            [user_id],
        )

        if len(result.rows) == 0:
            raise Exception('No refresh token found for user')

        refresh_token = result.rows[0]['refresh_token']
        auth_string = base64.b64encode(
            f"{os.getenv('SPOTIFY_CLIENT_ID')}:{os.getenv('SPOTIFY_CLIENT_SECRET')}".encode('utf-8')
        ).decode('utf-8')

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                SPOTIFY_TOKEN_URL,
                data={'grant_type': 'refresh_token', 'refresh_token': refresh_token},
                headers={
                    'Authorization': f"Basic {auth_string}",
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            )
            response.raise_for_status()
            token_data = response.json()

        access_token = token_data['access_token']
        expires_in = token_data['expires_in']
        new_refresh_token = token_data.get('refresh_token')
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        await query(
            """
            UPDATE auth_tokens
            SET access_token = $1,
                refresh_token = COALESCE($2, refresh_token),
                expires_at = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $4
            """,
            [access_token, new_refresh_token, expires_at, user_id],
        )

        return {'accessToken': access_token, 'expiresAt': expires_at}
    except Exception as exc:
        error_message = getattr(getattr(exc, 'response', None), 'text', None) or str(exc)
        print('Token refresh error:', error_message)
        raise Exception('Failed to refresh access token')


async def get_valid_access_token(user_id: str):
    try:
        result = await query(
            'SELECT access_token, expires_at FROM auth_tokens WHERE user_id = $1',
            [user_id],
        )

        if len(result.rows) == 0:
            raise Exception('No token found for user')

        access_token = result.rows[0]['access_token']
        expires_at = result.rows[0]['expires_at']
        now = datetime.utcnow()

        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
        if getattr(expires_at, 'tzinfo', None) is not None:
            expires_at = expires_at.astimezone(timezone.utc).replace(tzinfo=None)

        if (expires_at - now).total_seconds() < 5 * 60:
            print('Token expiring soon, refreshing...')
            refreshed = await refresh_access_token(user_id)
            return refreshed['accessToken']

        return access_token
    except Exception as exc:
        print('Error getting valid access token:', exc)
        raise


async def get_user_profile(access_token: str):
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                'https://api.spotify.com/v1/me',
                headers={'Authorization': f"Bearer {access_token}"},
            )
            response.raise_for_status()
            return response.json()
    except Exception as exc:
        error_message = getattr(getattr(exc, 'response', None), 'text', None) or str(exc)
        print('Error fetching user profile:', error_message)
        raise
