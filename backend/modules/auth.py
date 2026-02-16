import asyncio
import os
from datetime import datetime, timedelta, timezone

import spotipy
from spotipy.oauth2 import SpotifyOAuth
from spotipy.cache_handler import MemoryCacheHandler
from database.db import query

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


def _get_oauth():
    return SpotifyOAuth(
        client_id=os.getenv('SPOTIFY_CLIENT_ID'),
        client_secret=os.getenv('SPOTIFY_CLIENT_SECRET'),
        redirect_uri=os.getenv('SPOTIFY_REDIRECT_URI'),
        scope=REQUIRED_SCOPES,
        cache_handler=MemoryCacheHandler(),
        show_dialog=False,
    )


def _get_spotify_client(access_token: str):
    return spotipy.Spotify(auth=access_token, requests_timeout=20)


def get_authorization_url(state: str):
    oauth = _get_oauth()
    return oauth.get_authorize_url(state=state or 'default', show_dialog=False)


async def exchange_code_for_tokens(code: str):
    try:
        oauth = _get_oauth()
        token_data = await asyncio.to_thread(oauth.get_access_token, code, as_dict=True)
        access_token = token_data['access_token']
        refresh_token = token_data.get('refresh_token')
        expires_in = token_data['expires_in']

        spotify = _get_spotify_client(access_token)
        profile = await asyncio.to_thread(spotify.current_user)

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
        print('Token exchange error:', exc)
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
        oauth = _get_oauth()
        token_data = await asyncio.to_thread(oauth.refresh_access_token, refresh_token)

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
        print('Token refresh error:', exc)
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
        spotify = _get_spotify_client(access_token)
        return await asyncio.to_thread(spotify.current_user)
    except Exception as exc:
        print('Error fetching user profile:', exc)
        raise
