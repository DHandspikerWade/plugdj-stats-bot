FROM node:lts-slim
COPY package.json ./
RUN npm install -g node-gyp
RUN npm install
COPY index.js ./

ENV username ''
ENV password ''
ENV room ' '

CMD node ./index.js -e "$username" -p "$password" -r "$room" --bail