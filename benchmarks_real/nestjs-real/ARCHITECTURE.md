# NestJS RealWorld Architecture

This document maps the architectural flows, dependency injections, and authorization boundaries of the NestJS RealWorld application.

## 1. ROUTES & AUTHENTICATION FLOW

The application uses `AuthMiddleware` to protect specific routes. The middleware validates JWT tokens and injects the `req.user` object.

### User Module Routes (`user`)
- `GET /user` - **Guarded** (AuthMiddleware). Returns current user.
- `PUT /user` - **Guarded** (AuthMiddleware). Updates user.
- `POST /users` - Public. Creates a user. Uses `ValidationPipe`.
- `DELETE /users/:slug` - Public.
- `POST /users/login` - Public. Validates credentials and returns JWT. Uses `ValidationPipe`.

### Article Module Routes (`articles`)
- `GET /articles` - Public. Gets all articles.
- `GET /articles/feed` - **Guarded** (AuthMiddleware). Gets feed for user.
- `GET /articles/:slug` - Public. Get single article.
- `GET /articles/:slug/comments` - Public. Get comments on an article.
- `POST /articles` - **Guarded** (AuthMiddleware). Create article.
- `PUT /articles/:slug` - **Guarded** (AuthMiddleware). Update article.
- `DELETE /articles/:slug` - **Guarded** (AuthMiddleware). Delete article.
- `POST /articles/:slug/comments` - **Guarded** (AuthMiddleware). Create comment.
- `DELETE /articles/:slug/comments/:id` - **Guarded** (AuthMiddleware). Delete comment.
- `POST /articles/:slug/favorite` - **Guarded** (AuthMiddleware). Favorite article.
- `DELETE /articles/:slug/favorite` - **Guarded** (AuthMiddleware). Unfavorite article.

### Profile Module Routes (`profiles`)
- `POST /profiles/:username/follow` - **Guarded** (AuthMiddleware). Follow user.
- `DELETE /profiles/:username/follow` - **Guarded** (AuthMiddleware). Unfollow user.

---

## 2. DEPENDENCY INJECTION (DI) GRAPH

### Controllers
- `UserController` -> INJECTS `UserService`
- `ArticleController` -> INJECTS `ArticleService`
- `ProfileController` -> INJECTS `ProfileService`
- `TagController` -> INJECTS `TagService`

### Services (Data Flow)
- `UserService` -> INJECTS `TypeOrmModule` (`UserEntity`)
- `ArticleService` -> INJECTS `TypeOrmModule` (`ArticleEntity`, `Comment`, `UserEntity`, `FollowsEntity`)
- `AuthMiddleware` -> INJECTS `UserService` (to decode JWT and fetch `UserEntity`)

---

## 3. DATA FLOW (Entities)
The Database is accessed via TypeORM Repository pattern.
- **ArticleEntity**: Represents an article. Relations: `author` (UserEntity), `comments` (Comment).
- **UserEntity**: Represents a user. Relations: `articles`, `favorites`.
- **Comment**: Represents a comment on an article. Relations: `article`, `author`.
- **FollowsEntity**: Represents user follow relationships (follower/following).

---

## 4. EXTERNAL SERVICES / LIBRARIES
- **Authentication**: `passport-jwt` and `jsonwebtoken` for token validation in `AuthMiddleware`.
- **Validation**: `class-validator` via `ValidationPipe` applied explicitly to `POST /users` and `POST /users/login`.
- **Database**: `TypeORM` for Postgres/MySQL queries.
