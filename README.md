# 🌍 AfriWears — Backend API

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socket.io&logoColor=white)
![Paystack](https://img.shields.io/badge/Paystack-00C3F7?style=for-the-badge&logo=paystack&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

> The **REST API backend** for AfriWears — an African fashion e-commerce marketplace connecting customers with verified stylists selling native, corporate, casual, and traditional African wears.

---

## 📋 Table of Contents

- [Project Overview](#-project-overview)
- [Architecture Diagram](#-architecture-diagram)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Data Models](#-data-models)
- [API Reference](#-api-reference)
  - [Authentication](#-authentication--apiauthroutes)
  - [Users](#-users--apiusers)
  - [Products](#-products--apiproducts)
  - [Orders](#-orders--apiorders)
  - [Cart](#-cart--apicart)
  - [Wishlist](#-wishlist--apiwishlist)
  - [Stylists](#-stylists--apistylists)
  - [Messages](#-messages--apimessages)
  - [Notifications](#-notifications--apinotifications)
  - [Transactions](#-transactions--apitransactions)
  - [Addresses](#-addresses--apiaddresses)
  - [Webhooks](#-webhooks--apiwebhooks)
- [Authentication & Authorization](#-authentication--authorization)
- [Real-Time Features](#-real-time-features-socketio)
- [Caching Strategy](#-caching-strategy-redis)
- [Payment Integration](#-payment-integration-paystack)
- [Email Services](#-email-services)
- [Image Storage](#-image-storage-sanity)
- [Error Handling](#-error-handling)
- [Security](#-security)
- [Rate Limiting](#-rate-limiting)
- [Environment Variables](#-environment-variables)
- [Getting Started](#-getting-started)
- [Docker Setup](#-docker-setup)
- [Deployment](#-deployment)
- [Notable Implementation Details](#-notable-implementation-details)

---

## 🌍 Project Overview

AfriWears is a **multi-role African fashion marketplace**. The platform supports three user roles:

| Role | Description |
|---|---|
| **Customer (`user`)** | Browses and purchases products, places standard or custom orders |
| **Stylist** | Operates a fashion brand, submits products for admin approval, fulfils orders |
| **Admin** | Approves/rejects products and stylists, manages the entire platform |

### Key Capabilities

- **Multi-role authentication** with JWT access/refresh token rotation and up to 5 concurrent device sessions per user
- **Product approval workflow** — stylists submit products; admins approve or reject with reasons via real-time Socket.io notifications
- **Standard & custom orders** — customers order ready-made items or request custom-tailored outfits with measurements and material samples
- **Paystack payment integration** — supports card, bank transfer, wallet, USSD, and cash on delivery; includes Paystack webhook signature validation
- **Partial payment for custom orders** — 60% deposit on creation, remaining 40% collected before or on delivery
- **Redis caching** — aggressive caching of product, user, cart, and order data with pattern-based cache invalidation
- **Real-time notifications** — Socket.io events for order status changes, product approvals, and direct messaging
- **Image hosting on Sanity CMS** — product and avatar images uploaded to Sanity and served via CDN URL; cleaned up on deletion

---

## 🏗 Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                      AfriWears API                           │
│                 (Express.js on Node.js)                      │
├──────────────┬──────────────┬──────────────┬─────────────────┤
│  REST API    │  Socket.io   │ Rate Limiter │  Middleware     │
│  Routes      │  (WS Layer)  │ (per-IP)     │  Helmet, CORS   │
│              │              │              │  JWT, XSS       │
├──────────────┴──────────────┴──────────────┴─────────────────┤
│                     Business Logic Layer                      │
│             Controllers + Services (PaymentService)          │
├─────────────────────────┬────────────────────────────────────┤
│       MongoDB            │             Redis                  │
│  (Primary Data Store)    │       (Cache Layer)                │
│  Mongoose ODM            │  Products, Users, Cart, Orders     │
│                          │  (default TTL: 1 hour)             │
├─────────────────────────┼────────────────────────────────────┤
│       Paystack           │          Sanity CMS                │
│  (Payment Gateway)       │   (Cloud Image Asset Storage)      │
│  Webhook + Verify API    │   Products & Avatar CDN URLs       │
├─────────────────────────┼────────────────────────────────────┤
│       Nodemailer         │        Google OAuth 2.0            │
│  (Transactional Email)   │   (Passport.js — configurable)     │
└─────────────────────────┴────────────────────────────────────┘
```

---

## 🛠 Tech Stack

| Category | Technology | Version | Purpose |
|---|---|---|---|
| **Runtime** | Node.js | ≥ 18.x | JavaScript server runtime |
| **Framework** | Express.js | ^4.21.1 | HTTP server and routing |
| **Database** | MongoDB + Mongoose | ^8.8.2 | Primary data store and ODM |
| **Cache** | Redis | ^4.7.0 | Response caching |
| **Real-time** | Socket.io | ^4.8.1 | WebSocket notifications and messaging |
| **Auth** | jsonwebtoken | ^9.0.2 | JWT access and refresh tokens |
| **Auth** | bcryptjs | ^2.4.3 | Password hashing (salt rounds: 10) |
| **Auth** | passport + passport-google-oauth20 | ^0.7.0 | Google OAuth 2.0 strategy |
| **Payments** | paystack-api | ^2.0.6 | Nigerian payment gateway |
| **Email** | nodemailer | ^8.0.1 | Transactional emails |
| **Images** | @sanity/client | ^6.28.3 | Cloud image storage and CDN |
| **Security** | helmet | ^8.1.0 | HTTP security headers |
| **Security** | xss-clean | ^0.1.4 | XSS attack prevention |
| **Security** | express-rate-limit | ^7.5.0 | API rate limiting |
| **Uploads** | express-fileupload | ^1.5.1 | Multipart file handling with temp files |
| **Logging** | morgan | ^1.10.0 | HTTP request logging |
| **Validation** | validator | ^13.12.0 | Input sanitisation and email validation |
| **Dev** | nodemon | ^3.1.10 | Hot reload during development |

---

## 📁 Project Structure

```
afrikan-wears-backend/
│
├── app.js                           # Entry point — Express app bootstrap, middleware, routes
│
├── controllers/                     # Business logic layer
│   ├── authController.js            # Register, login, logout, token refresh, session management
│   ├── userController.js            # User CRUD, avatar upload to Sanity
│   ├── productController.js         # Product CRUD, approval workflow, reviews, image management
│   ├── orderController.js           # Order creation, payment verification, status updates
│   ├── cartController.js            # Cart add/update/remove, move-to-wishlist
│   ├── wishlistController.js        # Wishlist management
│   ├── stylistController.js         # Stylist company profiles and verification
│   ├── addressController.js         # User shipping/billing addresses
│   ├── messagesController.js        # Direct messaging between users and stylists
│   ├── notificationController.js    # Notification fetch and read status management
│   ├── transactionController.js     # Payment transaction history and wallet top-up
│   └── adminController.js           # Admin-only platform operations
│
├── routes/                          # Express Router definitions
│   ├── authRoute.js                 # /api/auth/*
│   ├── userRouter.js                # /api/users/*
│   ├── productRoute.js              # /api/products/*
│   ├── orderRoute.js                # /api/orders/*
│   ├── cartRoute.js                 # /api/cart/*
│   ├── wishlistRoute.js             # /api/wishlist/*
│   ├── stylistRoute.js              # /api/stylists/*
│   ├── addressRoute.js              # /api/addresses/*
│   ├── messagesRoute.js             # /api/messages/*
│   ├── notificationRoute.js         # /api/notifications/*
│   ├── transactionRoute.js          # /api/transactions/*
│   └── webhooks.js                  # /api/webhooks (Paystack events)
│
├── models/                          # Mongoose schemas
│   ├── userModel.js                 # User: roles, wallet, email verification, Google OAuth
│   ├── productModel.js              # Product: images, variants, reviews, approval status, SKU
│   ├── orderModel.js                # Order: items, payment info, custom order measurements
│   ├── cartModel.js                 # Shopping cart
│   ├── wishlistModel.js             # Wishlist
│   ├── stylistModel.js              # Stylist company: portfolio, verification, ratings
│   ├── messageModel.js              # Direct messages
│   ├── notificationModel.js         # System notifications (all roles)
│   ├── tokenModel.js                # Refresh token sessions (multi-device, max 5)
│   ├── transactionModel.js          # Payment transaction records
│   ├── userAddressModel.js          # User addresses
│   └── userStatusModel.js           # Online/offline status for Socket.io
│
├── middleware/
│   ├── authentication.js            # JWT auth guard + role-based authorization helpers
│   ├── error-handler.js             # Global Express error middleware
│   ├── not-found.js                 # 404 catch-all handler
│   └── sample.js                    # Utility middleware
│
├── errors/                          # Custom error classes
│   ├── custom-error.js              # Base CustomError (extends Error)
│   ├── authentication-error.js      # 401 Unauthenticated
│   ├── authorization-error.js       # 403 Unauthorized
│   ├── bad-request.js               # 400 Bad Request
│   ├── not-found.js                 # 404 Not Found
│   └── index.js                     # Barrel export
│
├── utils/
│   ├── paystack.js                  # PaymentService class (init, verify, webhook, wallet)
│   ├── redisClient.js               # Redis connection + get/set/clear cache helpers
│   ├── jwt.js                       # JWT sign and verify utilities
│   ├── socket.js                    # emitNotification helper (wraps io.to().emit())
│   ├── setupSocketHandlers.js       # Socket.io connection/room/event handlers
│   ├── sanityConfig.js              # Sanity read/write client config
│   ├── googleOauth.js               # Passport Google OAuth 2.0 strategy
│   ├── payment.js                   # generatePaymentReference utility
│   ├── userPayload.js               # Builds sanitised JWT user payload
│   ├── skuGenerator.js              # Auto-generates SKU from category + product name
│   ├── index.js                     # Barrel exports
│   │
│   ├── Email/
│   │   ├── EmailConfig.js           # Nodemailer transporter setup
│   │   ├── sendMail.js              # Generic send-mail wrapper
│   │   ├── sendVerificationMail.js  # Registration email verification
│   │   ├── sendResetPasswordEmail.js# Password reset link email
│   │   ├── sendOrderEmail.js        # Order placed and status update emails
│   │   └── sendFoundWalletEmail.js  # Wallet top-up success email
│   │
│   └── helper/
│       ├── clearAuthCookies.js      # Clears accessToken + refreshToken cookies
│       ├── getDeviceInfo.js         # Extracts IP, user-agent, deviceId from request
│       ├── getTokenExpity.js        # Computes refresh token expiration date
│       └── migration.js             # Data migration scripts
│
└── db/
    └── connectDB.js                 # MongoDB connection function
```

---

## 🗄 Data Models

### User Model
| Field | Type | Notes |
|---|---|---|
| `firstName`, `surname` | String | Required |
| `email` | String | Unique, validated with `validator.isEmail` |
| `password` | String | Bcrypt hashed; enforces uppercase, number, symbol via `validator.isStrongPassword` |
| `role` | Enum | `user` \| `stylist` \| `admin` |
| `company` | ObjectId → Stylist | Populated when role is `stylist` |
| `walletAmount` | Number | In-app wallet balance (default: 0) |
| `isVerified` | Boolean | Must be `true` before login is allowed |
| `verificationToken` | String | Expires in 1 hour; used for email verify and password reset |
| `googleId` | String | Sparse unique index for Google OAuth |
| `avatar` | String | Sanity CDN URL (default: `/avatar.jpg`) |
| `addresses` | Virtual | Populated from `Address` model via `localField: _id` |

### Product Model
| Field | Type | Notes |
|---|---|---|
| `name`, `description` | String | Required; max 100 and 1000 chars respectively |
| `price` | Number | Required, min 0 |
| `mainImage` | String | Validated URL (must match `https?://`) |
| `subImages` | [String] | Array of validated CDN URLs |
| `category` | Enum | `men` \| `women` \| `unisex` \| `material` |
| `type` | Enum | `native` \| `corporate` \| `casual` \| `traditional` |
| `attributes` | Object | `colors` (name + hexCode), `sizes` (array), `material` |
| `stock` | Number | Required, min 0 |
| `sku` | String | Auto-generated on first save, immutable |
| `slug` | String | Auto-generated from `name` |
| `status` | Enum | `pending` \| `approved` \| `rejected` |
| `isAdminApproved` | Boolean | Controlled exclusively by admin |
| `createdBy` | Enum | `stylist` \| `admin` |
| `reviews` | Array | Embedded subdocs: `{ user, rating (0–5), comment }` |
| `rejectionReason` | String | Set by admin on rejection |
| `approvedBy` | ObjectId → User | Admin who processed the product |

### Order Model
| Field | Type | Notes |
|---|---|---|
| `customer` | ObjectId → User | Required |
| `orderItems` | Array | Each item: `{ product, quantity, priceAtPurchase, stylist, status, orderType, measurements, materialSample }` |
| `paymentInfo.paymentMethod` | Enum | `wallet` \| `credit_card` \| `bank_transfer` \| `cash_on_delivery` |
| `paymentInfo.paymentStatus` | Enum | `pending` \| `partially_paid` \| `completed` \| `failed` |
| `paymentInfo.amountPaid` | Number | Cumulative amount paid |
| `paymentInfo.balanceDue` | Number | For custom orders: 40% remaining balance |
| `paymentInfo.transactionId` | String | Paystack reference used for verification |
| `orderStatus` | Enum | `pending` \| `processing` \| `shipped` \| `delivered` |
| `itemsPrice` | Number | Sum of all item prices × quantity |
| `taxPrice` | Number | 10% of `itemsPrice` |
| `shippingPrice` | Number | Flat ₦15 |
| `totalPrice` | Number | `itemsPrice + taxPrice + shippingPrice` |

### Token Model (Refresh Sessions)
| Field | Type | Notes |
|---|---|---|
| `refreshToken` | String | Random 40-byte hex, rotated on every refresh |
| `user` | ObjectId → User | Associated user |
| `deviceInfo` | Object | `{ ip, userAgent, deviceId }` |
| `isValid` | Boolean | Set to `false` on logout or reuse detection |
| `expiresAt` | Date | Hard expiry enforced in query filter |
| `lastUsed` | Date | Updated on every valid refresh; used for LRU eviction |

---

## 📡 API Reference

> **Base URL:** `https://afrikan-wears-backend.onrender.com`
>
> Protected routes require a valid `accessToken` signed cookie.
> The `🔒` symbol indicates authentication is required; role constraints are noted in the Description column.

---

### 🔐 Authentication — `/api/auth` (routes)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/register` | Public | Register as user; include `companyName` to register as stylist |
| `POST` | `/verify-email` | Public | Verify email with `{ email, verificationToken }` |
| `POST` | `/reverify-email` | Public | Resend a new verification email |
| `POST` | `/login` | Public | Authenticate; sets signed `accessToken` + `refreshToken` cookies |
| `POST` | `/logout` | 🔒 Auth | Invalidates current session's refresh token |
| `POST` | `/forgot-password` | Public | Sends password reset email (token expires in 1hr) |
| `POST` | `/reset-password` | Public | Reset password with `{ email, verificationToken, password }` |
| `POST` | `/refresh-token` | Public | Rotate access + refresh tokens (token reuse triggers full session revoke) |
| `GET` | `/validate-tokens` | Public | Check if current cookies are valid (used by Next.js middleware) |
| `GET` | `/me` | 🔒 Auth | Returns current user's profile and company |
| `GET` | `/sessions` | 🔒 Auth | List all active sessions with device info |
| `DELETE` | `/sessions/:sessionId` | 🔒 Auth | Revoke a specific device session |
| `DELETE` | `/sessions` | 🔒 Auth | Revoke all sessions except the current one |

**Register Request Body:**
```json
{
  "firstName": "Amaka",
  "surname": "Okafor",
  "email": "amaka@example.com",
  "password": "Pass@1234",
  "companyName": "AmakaStyles"
}
```
> Providing `companyName` automatically sets the role to `stylist` and creates a linked `Stylist` company document. The first registered user is automatically promoted to `admin`.

---

### 👤 Users — `/api/users`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/` | 🔒 Admin | Get all users (paginated; filter by `name`) |
| `GET` | `/me` | 🔒 Auth | Get own profile (with populated addresses) |
| `GET` | `/:id` | 🔒 Admin | Get any user's detail |
| `PATCH` | `/update-me` | 🔒 Auth | Update own profile (name, phone, newsletter, avatar URL) |
| `PATCH` | `/:id` | 🔒 Admin | Update any user field including role |
| `DELETE` | `/:id` | 🔒 Admin | Delete a user |
| `POST` | `/upload-avatar` | 🔒 Auth | Upload avatar image; returns Sanity CDN URL |

---

### 👗 Products — `/api/products`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/` | Public | Get all **approved** products (filterable, paginated) |
| `GET` | `/:productId` | Public | Get single product detail with reviews and stylist info |
| `POST` | `/` | 🔒 Stylist / Admin | Create product (status is `pending` if created by stylist) |
| `PATCH` | `/:productId` | 🔒 Stylist / Admin | Update product (stylists can only update own pending products) |
| `DELETE` | `/:productId` | 🔒 Stylist / Admin | Delete product (stylists can only delete own pending) |
| `GET` | `/my-products` | 🔒 Stylist | Get own products (all statuses) |
| `GET` | `/all-products-admin` | 🔒 Admin | Get all products regardless of status |
| `PUT` | `/verify/:productId` | 🔒 Admin | Approve or reject a pending product |
| `POST` | `/upload-product-image` | 🔒 Stylist / Admin | Upload image to Sanity; returns CDN URL |
| `DELETE` | `/delete-product-image` | 🔒 Stylist / Admin | Delete image from Sanity by URL |
| `POST` | `/:productId/review` | 🔒 User | Add review (only allowed for delivered purchases) |
| `PATCH` | `/:productId/review/:reviewId` | 🔒 Auth | Update own review |

**Available Query Filters for `GET /api/products`:**
```
?category=women
?type=traditional
?featured=true
?name=agbada
?stylist=<stylistId>
?page=1&limit=12
```

**Verify Product Body:**
```json
{
  "action": "reject",
  "reason": "Images are too low resolution. Please re-upload at minimum 500×500px."
}
```

---

### 📦 Orders — `/api/orders`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/` | 🔒 User | Create order from active cart |
| `GET` | `/` | 🔒 Admin | Get all orders (paginated) |
| `GET` | `/my-orders` | 🔒 Auth | Get own order history |
| `GET` | `/stylist/orders` | 🔒 Stylist | Get orders containing stylist's products |
| `GET` | `/verify-payment` | 🔒 Auth | Verify Paystack payment via `?reference=<ref>` |
| `GET` | `/:id` | 🔒 Auth | Get single order detail |
| `POST` | `/:orderId/complete-payment` | 🔒 Auth | Pay final balance for a custom order |
| `PATCH` | `/:id/status` | 🔒 Stylist / Admin | Update overall order status |
| `PATCH` | `/:id/items/:itemId/status` | 🔒 Stylist / Admin | Update a single order item's status |

**Create Standard Order:**
```json
{
  "shippingAddress": {
    "street": "12 Bode Thomas Street",
    "city": "Lagos",
    "state": "Lagos",
    "country": "Nigeria"
  },
  "paymentMethod": "credit_card",
  "orderType": "standard"
}
```

**Create Custom Order:**
```json
{
  "shippingAddress": { "street": "...", "city": "Abuja", "state": "FCT", "country": "Nigeria" },
  "paymentMethod": "bank_transfer",
  "orderType": "custom",
  "measurements": {
    "chest": "42in",
    "waist": "36in",
    "hips": "44in",
    "inseam": "32in"
  },
  "materialSample": "https://cdn.sanity.io/images/..."
}
```
> Custom orders charge **60% upfront**. The remaining 40% is due before or on delivery via `POST /orders/:id/complete-payment`.

---

### 🛒 Cart — `/api/cart`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/` | 🔒 Auth | Get cart items with populated product details and total price |
| `POST` | `/` | 🔒 Auth | Add item to cart (merges quantity if product already in cart) |
| `PATCH` | `/:id` | 🔒 Auth | Update quantity for a cart item |
| `DELETE` | `/` | 🔒 Auth | Remove a specific product from cart |
| `DELETE` | `/clear` | 🔒 Auth | Clear the entire cart |
| `POST` | `/move-to-wishlist` | 🔒 Auth | Atomically remove from cart and add to wishlist |

---

### ❤️ Wishlist — `/api/wishlist`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/` | 🔒 Auth | Get all wishlist items |
| `POST` | `/` | 🔒 Auth | Add a product to wishlist |
| `DELETE` | `/` | 🔒 Auth | Remove a product fr
