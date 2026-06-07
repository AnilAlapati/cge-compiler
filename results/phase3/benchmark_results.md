# Multi-Repository Architecture Benchmark Results

| Repository | Raw | Gen Map | Gen + Raw |
| ---------- | --- | ------- | --------- |
| domain-driven-hexagon | 80% | 30% | 90% |
| nestjs-boilerplate | 80% | 80% | 90% |
| nestjs-prisma-starter | 80% | 70% | 90% |
| nestjs-realworld | 100% | 100% | 90% |

## Coverage Gaps (Failures in Gen+Raw)

### domain-driven-hexagon

| Question | Expected | Model Answer |
| -------- | -------- | ------------ |
| What are the command handlers registered in the UserModule? | CreateUserService,DeleteUserService,FindUsersQueryHandler | In the `UserModule`, the registered command handlers are:  1. **CreateUserService**: This handles the `CreateUserCommand`. 2. **DeleteUserService**: This handles the `DeleteUserCommand`.  These command handlers are specified in the `providers` array of the `UserModule` as follows:  ```typescript const commandHandlers: Provider[] = [CreateUserService, DeleteUserService]; ```  Thus, the command handlers registered in the `UserModule` are `CreateUserService` and `DeleteUserService`. |

### nestjs-boilerplate

| Question | Expected | Model Answer |
| -------- | -------- | ------------ |
| What are the main modules imported in the AppModule? | ConfigModule,TypeOrmModule,I18nModule,UsersModule,FilesModule,AuthModule,AuthFacebookModule,AuthGoogleModule,AuthAppleModule,SessionModule,MailModule,MailerModule,HomeModule | The main modules imported in the `AppModule` are as follows:  1. **ConfigModule**: This module is used for configuration management and is set to be global. 2. **MongooseModule**: This module is used for MongoDB integration when the database is a document database. 3. **TypeOrmModule**: This module is used for relational database integration when the database is not a document database. 4. **UsersModule**: This module handles user-related functionalities. 5. **FilesModule**: This module manages file-related functionalities. 6. **AuthModule**: This module is responsible for authentication functionalities. 7. **AuthAppleModule**: This module handles authentication via Apple. 8. **AuthFacebookModule**: This module handles authentication via Facebook. 9. **AuthGoogleModule**: This module handles authentication via Google. 10. **SessionModule**: This module manages session-related functionalities. 11. **MailModule**: This module is responsible for email functionalities. 12. **MailerModule**: This module provides mailer services. 13. **HomeModule**: This module handles home-related functionalities. 14. **I18nModule**: This module is used for internationalization.  These modules collectively provide the necessary functionalities for the application, including user management, authentication, file handling, session management, email services, and configuration management. |

### nestjs-prisma-starter

| Question | Expected | Model Answer |
| -------- | -------- | ------------ |
| What are the methods defined in the PostsResolver? | postCreated, createPost, publishedPosts, userPosts, post | The `PostsResolver` class defines the following methods:  1. **postCreated**:     - Decorated with `@Subscription(() => Post)`, this method is used to listen for the `postCreated` event, which is published when a new post is created.  2. **createPost**:     - Decorated with `@Mutation(() => Post)`, this method allows authenticated users to create a new post. It takes the `CreatePostInput` as an argument and uses the `UserEntity` decorator to get the current user. It creates a new post in the database and publishes the `postCreated` event.  3. **publishedPosts**:     - Decorated with `@Query(() => PostConnection)`, this method retrieves a paginated list of published posts. It accepts pagination arguments and an optional query string to filter posts by title.  4. **userPosts**:     - Decorated with `@Query(() => [Post])`, this method retrieves all published posts for a specific user, identified by the `UserIdArgs`.  5. **post**:     - Decorated with `@Query(() => Post)`, this method retrieves a specific post by its ID, which is provided through the `PostIdArgs`.  6. **author**:     - Decorated with `@ResolveField('author', () => User)`, this method resolves the author of a post. It retrieves the author information based on the post's ID.  These methods facilitate the creation, retrieval, and management of posts within the application. |

### nestjs-realworld

| Question | Expected | Model Answer |
| -------- | -------- | ------------ |
| What middleware is applied to the Profile module routes? | AuthMiddleware | The middleware applied to the Profile module routes is the `AuthMiddleware`. It is configured to be applied for all routes under the path `profiles/:username/follow`. This means that any requests to follow or unfollow a user will require authentication through this middleware. |

