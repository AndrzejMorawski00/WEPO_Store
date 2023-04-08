const http = require("http");

const express = require("express");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const flash = require("express-flash");
const bcrypt = require("bcrypt");
// const path = require('path')
const multer = require("multer");
const fs = require("fs");
const { pool } = require("./dbConfig");

require("dotenv").config();

const app = express();
const port = process.env.SERVER_PORT || 3200;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.set("view engine", "ejs");
app.set("views", "./views");

app.disable("etag");

app.use(cookieParser("This is a secret key"));
app.use(express.urlencoded({ extended: true }));
app.use(flash());
app.use("/static", express.static("static"));
//app.use()
app.use(
  session({
    secret: "secret",
    resave: false,
    saveUninitialized: false,
  })
);

//Multer

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./static/images");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + file.originalname);
  },
});

const multerUpload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype == "image/png" ||
      file.mimetype == "image/jpg" ||
      file.mimetype == "image/jpeg"
    ) {
      cb(null, true);
    } else {
      cb(null, false);
      return cb(new Error("Only .png, .jpg and .jpeg format allowed!"));
    }
  },
});

const fileUpload = multerUpload.single("product_image");

// Views
//Index
app.get("/", (req, res) => {
  pool.query(
    `SELECT * FROM products WHERE is_visible=$1`,
    [true],
    (err, results) => {
      if (req.signedCookies.user_id) {
        res.render("index", {
          user_id: req.signedCookies.user_id,
          is_user: req.signedCookies.is_user,
          is_admin: req.signedCookies.is_admin,
          products: results.rows,
        });
      } else {
        res.render("index", { products: results.rows });
      }
    }
  );
});

//Add product to cart
app.post("/", (req, res) => {
  if (req.signedCookies.user_id) {
    // Create object of products
    let productData = Object.keys(req.body)[0].split(" ");
    if (productData[0] === "Add") {
      getUserData(req.signedCookies.user_id)
        .then((userData) => {
          let cartData = JSON.parse(userData.rows[0].user_cart);
          if (cartData === null || cartData === "" || cartData == "{}") {
            cartData = {};
          }
          if (cartData[Number(productData[1])] !== undefined) {
            cartData[Number(productData[1])] += 1;
          } else {
            cartData[Number(productData[1])] = 1;
          }

          pool.query(
            `UPDATE users SET user_cart=$1 WHERE id=$2`,
            [JSON.stringify(cartData), req.signedCookies.user_id],
            (err) => {
              if (err) {
                throw err;
              }
              res.redirect("/");
            }
          );
        })
        .catch((err) => {
          console.log(err);
        });
    } else {
      res.redirect("/");
    }
  }
});
//Cart view
app.get("/cart", (req, res) => {
  if (req.signedCookies.is_user) {
    pool.query(
      `SELECT * FROM users WHERE id=$1`,
      [req.signedCookies.user_id],
      (err, results) => {
        if (err) {
          throw err;
        }
        let productKeys = Object.keys(
          JSON.parse(results.rows[0].user_cart)
        ).map((key) => {
          return parseInt(key, 10);
        });
        let productAmount = Object.values(
          JSON.parse(results.rows[0].user_cart)
        );

        getProductData(productKeys)
          .then((productData) => {
            res.render("cart", {
              productList: productData.rows,
              productAmount: productAmount,
            });
          })
          .catch((err) => {
            console.log(err);
          });
      }
    );
  } else {
    res.redirect("/");
  }
});
//Cart Post
app.post("/cart", (req, res) => {
  if (req.signedCookies.user_id) {
    let operation = Object.keys(req.body)[0].split(" ");

    if (operation[0] === "remove") {
      getUserData(req.signedCookies.user_id)
        .then((userData) => {
          let userCart = JSON.parse(userData.rows[0].user_cart);
          if (userCart[operation[1]] > 1) {
            userCart[operation[1]] -= 1;
          } else if (userCart[operation[1]] === 1) {
            delete userCart[operation[1]];
          }

          pool.query(
            `UPDATE users SET user_cart=$1 WHERE id=$2`,
            [JSON.stringify(userCart), req.signedCookies.user_id],
            (err) => {
              if (err) {
                throw err;
              }
              res.redirect("/cart");
            }
          );
        })
        .catch((err) => {
          throw err;
        });
    } else if (operation[0] === "order") {
      if (Number(operation[1]) !== 0) {
        getUserData(req.signedCookies.user_id).then((userData) => {
          let { user_cart } = userData.rows[0];
          pool.query(
            `UPDATE users SET user_cart=$1 WHERE id=$2`,
            [JSON.stringify(""), req.signedCookies.user_id],
            (err) => {
              if (err) {
                throw err;
              }
            }
          );
          pool.query(
            `INSERT INTO orders (user_id, price, products, status) 
                VALUES ($1, $2, $3, $4)`,
            [req.signedCookies.user_id, Number(operation[1]), user_cart, false],
            (err) => {
              if (err) {
                throw err;
              }
              res.redirect("/");
            }
          );
        });
      } else {
        res.redirect("/cart");
      }
    }
  } else {
    res.redirect("/");
  }
});
//Profile
app.get("/users/profile", (req, res) => {
  if (req.signedCookies.user_id) {
    pool.query(
      `SELECT * FROM orders WHERE user_id=$1`,
      [req.signedCookies.user_id],
      (err, results) => {
        if (err) {
          throw err;
        }
        res.render("profile", { orderData: results.rows });
      }
    );
  } else {
    res.redirect("/");
  }
});

//Login Logout Register
const matchPassword = async (user_password, hashedPassword, errors) => {
  const match = await bcrypt.compare(user_password, hashedPassword);
  if (match) {
    return true;
  }
  return false;
};

app.get("/users/login", (req, res) => {
  if (!req.signedCookies.user_id) {
    res.render("login");
  } else {
    res.redirect("/");
  }
});

app.post("/users/login", async (req, res) => {
  if (!req.signedCookies.user_id) {
    let { user_email, user_password } = req.body;
    let errors = [];

    pool.query(
      `SELECT * FROM users
        WHERE e_mail = $1`,
      [user_email],
      (err, results) => {
        if (err) {
          throw err;
        }
        if (results.rows.length === 0) {
          errors.push({ message: "Invalid email or password" });
          res.render("login", { errors });
        } else {
          matchPassword(user_password, results.rows[0].password, errors).then(
            (result) => {
              if (result) {
                res.cookie("user_id", results.rows[0].id, { signed: true });
                res.cookie("is_user", results.rows[0].is_user, {
                  signed: true,
                });
                res.cookie("is_admin", results.rows[0].is_admin, {
                  signed: true,
                });
                res.redirect("/");
              } else {
                errors.push({ message: "Invalid email or password" });
                console.log(errors);
                res.render("login", { errors });
              }
            }
          );
        }
      }
    );
  } else {
    res.redirect("/");
  }
});

// Register
app.get("/users/register", (req, res) => {
  if (!req.signedCookies.user_id) {
    res.render("register");
  } else {
    res.redirect("/");
  }
});
app.post("/users/register", async (req, res) => {
  if (!req.signedCookies.user_id) {
    let { first_name, last_name, user_email, user_password, confirm_password } =
      req.body;

    let errors = [];
    if (!user_email || !user_password || !confirm_password) {
      errors.push({ message: "Please enter required fields." });
    }
    if (user_password.length < 6) {
      errors.push({ message: "Password should be at least 6 characters" });
    }
    if (user_password !== confirm_password) {
      errors.push({ message: "Passwords do not match" });
    }
    if (!emailPattern.test(user_email)) {
      errors.push({ message: "Please enter correct email" });
    }
    if (errors.length > 0) {
      res.render("register", { errors });
    } else {
      let hashedPassword = await bcrypt.hash(
        user_password,
        Number(process.env.HASH_SALT) || 10
      );

      pool.query(
        `SELECT * FROM users 
            WHERE e_mail = $1`,
        [user_email],
        (err, results) => {
          if (err) {
            throw err;
          }

          if (results.rows.length > 0) {
            errors.push({ message: "Email already registred" });
            res.render("register", { errors });
          } else {
            pool.query(
              `INSERT INTO users (first_name, last_name, e_mail, password) 
                        VALUES ($1, $2, $3, $4)
                        RETURNING id, password`,
              [first_name, last_name, user_email, hashedPassword],
              (err, results) => {
                if (err) {
                  throw err;
                }

                req.flash(
                  "success_msg",
                  "You re now registered. Please log in"
                );
                res.redirect("/users/login");
              }
            );
          }
        }
      );
    }
  } else {
    res.redirect("/");
  }
});

//Logout
app.get("/users/logout", (req, res) => {
  if (req.signedCookies.user_id) {
    res.clearCookie("user_id");
    res.clearCookie("is_user");
    res.clearCookie("is_admin");
    res.redirect("/");
  } else {
    res.redirect("login");
  }
});

//User Profile

app.get("/users/profile", (req, res) => {
  if (req.signedCookies.user_id) {
  } else {
    res.redirect("login");
  }
});

//Admin Panel
app.get("/admin-panel", (req, res) => {
  if (req.signedCookies.is_admin) {
    res.render("admin-panel");
  } else {
    res.redirect("/");
  }
});
//View products
app.get("/admin-panel/products", (req, res) => {
  if (req.signedCookies.is_admin) {
    pool.query(`SELECT * FROM products`, (err, results) => {
      if (err) {
        throw err;
      }
      res.render("products", { products: results.rows });
    });
  } else {
    res.redirect("/");
  }
});
//Edit Product
app.get("/admin-panel/products/edit/:id", (req, res) => {
  if (req.signedCookies.is_admin) {
    pool.query(
      `SELECT * FROM products WHERE id = $1`,
      [Number(req.params.id)],
      (err, results) => {
        if (err) {
          throw err;
        }
        if (results.rows[0].length !== 0) {
          res.render("edit", { product: results.rows[0] });
        } else {
          res.redirect("admin/admin-panel/products");
        }
      }
    );
  } else {
    res.redirect("/");
  }
});

app.post("/admin-panel/products/edit/:id", (req, res) => {
  if (req.signedCookies.is_admin) {
    fileUpload(req, res, (err) => {
      if (err) {
        console.log(err);
        throw err;
      } else {
        if (req.body.save_changes !== undefined) {
          let product_img = "";
          let is_visible = false;

          let { product_name, product_price, product_size, product_visible } =
            req.body;
          if (product_visible === "on") {
            is_visible = true;
          }
          if (req.file !== undefined) {
            product_img = req.file.filename;
          }

          getProductData([Number(req.params.id)])
            .then((results) => {
              if (results.rows[0].photo !== "" && product_img !== "") {
                try {
                  let path =
                    __dirname + `/static/images/${results.rows[0].photo}`;

                  fs.rmSync(path);
                } catch (err) {
                  console.log(err);
                }
              } else if (results.rows[0].photo !== "") {
                product_img = results.rows[0].photo;
              }

              pool.query(
                `UPDATE products SET name=$1, price=$2, photo=$3, size=$4, is_visible=$5 WHERE id=$6`,
                [
                  product_name,
                  Number(product_price),
                  product_img,
                  Number(product_size),
                  is_visible,
                  Number(req.params.id),
                ],
                (err) => {
                  if (err) {
                    throw err;
                  }
                  res.redirect("/admin-panel/products/");
                }
              );
            })
            .catch((err) => {
              console.log(err);
            });
        } else if (req.body.delete !== undefined) {
          pool.query(
            `DELETE FROM products WHERE id=$1`,
            [Number(req.params.id)],
            (err, result) => {
              if (err) {
                throw err;
              }
              res.redirect("/admin-panel/products");
            }
          );
        } else {
          res.redirect("/admin-panel/products");
        }
      }
    });
  } else {
    res.redirect("/");
  }
});

//View users
app.get("/admin-panel/users", (req, res) => {
  if (req.signedCookies.is_admin) {
    pool.query(`SELECT * FROM users`, [], (err, results) => {
      if (err) {
        throw err;
      }

      res.render("users", { users: results.rows });
    });
  } else {
    res.redirect("/");
  }
});

//View orders
app.get("/admin-panel/orders", (req, res) => {
  if (req.signedCookies.is_admin) {
    getOrderList().then((orders) => {
      let orderData = [];
      orders.rows.forEach((order) => {
        orderData.push(
          getData(
            order.user_id,
            Object.keys(JSON.parse(order.products)).map((key) => {
              return parseInt(key, 10);
            })
          ).then((results) => {
            return [order, results[0].rows, results[1].rows[0]];
          })
        );
      });
      Promise.all(orderData).then((values) => {
        res.render("orders", { orderData: values });
      });
    });
  } else {
    res.redirect("/");
  }
});
//Change order status
app.post("/admin-panel/orders", (req, res) => {
  if (req.signedCookies.is_admin) {
    let orderData = Object.keys(req.body)[0].split(" ");
    console.log(Number(orderData[1]));
    pool.query(
      `UPDATE orders SET status = NOT status WHERE id=$1`,
      [Number(orderData[1])],
      (err) => {
        if (err) {
          throw err;
        }
        res.redirect("/admin-panel/orders");
      }
    );
  } else {
    res.redirect("/");
  }
});

//Add new product
app.get("/admin-panel/add-new", (req, res) => {
  if (req.signedCookies.is_admin) {
    res.render("add-new");
  } else {
    res.redirect("/");
  }
});

app.post("/admin-panel/add-new", (req, res) => {
  let errors = [];
  if (req.signedCookies.is_admin) {
    fileUpload(req, res, (err) => {
      if (err) {
        errors.push({ message: "Error occured during saving image" });
        res.render("add-new", { errors });
      } else {
        product_img = "";
        if (req.file !== undefined) {
          product_img = req.file.filename;
        }
        let is_visible = false;
        let { product_name, product_price, product_size, product_visible } =
          req.body;

        if (product_visible == "on") {
          is_visible = true;
        }
        pool.query(
          `INSERT INTO products (name, price, photo, size, is_visible)
                    VALUES ($1, $2, $3, $4, $5)
                    `,
          [product_name, product_price, product_img, product_size, is_visible],
          (err) => {
            if (err) {
              throw err;
            }
            res.redirect("/admin-panel/products");
          }
        );
      }
    });
  } else {
    res.redirect("/");
  }
});

http.createServer(app).listen(port);
console.log(`Server Strating on port ${port}`);

const getOrderList = async () => {
  return pool.query(`SELECT * FROM orders`);
};
const getUserData = async (user_id) => {
  return pool.query(`SELECT * FROM users WHERE id = $1`, [user_id]);
};
const getProductData = async (productList) => {
  return pool.query(`SELECT * FROM products WHERE id = ANY($1::int[])`, [
    productList,
  ]);
};
const getData = async (user_id, productList) => {
  return Promise.all([getProductData(productList), getUserData(user_id)]);
};
