#!/bin/bash
set -e

mkdir -p benchmarks_massive
cd benchmarks_massive

echo "Cloning repositories..."

# 1. NestJS RealWorld (TS / Backend)
[ ! -d "nestjs-realworld" ] && git clone --depth 1 https://github.com/lujakob/nestjs-realworld-example-app.git nestjs-realworld

# 2. Medusa (TS / Backend)
[ ! -d "medusa" ] && git clone --depth 1 https://github.com/medusajs/medusa.git medusa

# 3. Next.js Commerce (TS / Frontend)
[ ! -d "commerce" ] && git clone --depth 1 https://github.com/vercel/commerce.git commerce

# 4. React Admin (TS / Frontend)
[ ! -d "react-admin" ] && git clone --depth 1 https://github.com/marmelab/react-admin.git react-admin

# 5. FastAPI (Python / Backend)
[ ! -d "fastapi" ] && git clone --depth 1 https://github.com/fastapi/fastapi.git fastapi

# 6. Django (Python / Backend)
[ ! -d "django" ] && git clone --depth 1 https://github.com/django/django.git django

# 7. Spring PetClinic (Java / Backend)
[ ! -d "spring-petclinic" ] && git clone --depth 1 https://github.com/spring-projects/spring-petclinic.git spring-petclinic

# 8. Spring Framework (Java / Framework)
[ ! -d "spring-framework" ] && git clone --depth 1 https://github.com/spring-projects/spring-framework.git spring-framework

# 9. ripgrep (Rust / Systems)
[ ! -d "ripgrep" ] && git clone --depth 1 https://github.com/BurntSushi/ripgrep.git ripgrep

# 10. fmt (C++ / Systems)
[ ! -d "fmt" ] && git clone --depth 1 https://github.com/fmtlib/fmt.git fmt

echo "Done cloning 10 repos."
